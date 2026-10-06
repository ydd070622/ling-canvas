//! 画布内的 Claude Code 智能体 | Canvas agent
//!
//! 一次对话 = 一个 `claude -p` 进程，用完即退。第一轮用 `--session-id <我们生成的 uuid>`
//! 建立会话，之后用 `--resume <同一个 uuid>` 续接上下文 —— Claude Code 自己会把会话
//! 存在磁盘上，我们不需要常驻进程，也就不必自己实现 stdin 的帧协议。
//!
//! 三个 Windows 上的坑，缺一个都跑不起来：
//!
//! 1. **`claude` 是 `.cmd` 批处理 shim**，不能直接 `Command::new("claude")`，
//!    必须交给 `cmd /c` 去解析。真正的 node 进程是它的孙子进程。
//! 2. **关进程要树杀**。杀掉 cmd.exe 不会带走孙子 node.exe，得 `taskkill /T`。
//! 3. **不弹黑框**。没有 `CREATE_NO_WINDOW` 的话每次对话都会闪一个控制台窗口。
//!
//! 使用默认工具集，预批准本地技能、命令执行、文件编辑和检索。
//!
//! 命令行里能出现的东西也都是 uuid / 字面量这类绝对安全的值：用户提示词走 stdin、
//! 系统提示词走 `--append-system-prompt-file` 落文件，两者都不必转义。
//!
//! **输入走 `--input-format stream-json`**：一行 JSONL 的 content blocks，图片作为
//! base64 block 直接喂给模型 —— 实测图片是有效的视觉输入，不需要为它再开任何工具。
//! 这一行由前端 `buildAgentInputLine` 拼好（JSON 转义交给 `JSON.stringify`），
//! Rust 不碰内容、只管写进 stdin。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(serde::Serialize)]
pub struct LocalSkill {
    name: String,
    description: String,
}

#[tauri::command]
pub fn list_agent_skills() -> Result<Vec<LocalSkill>, String> {
    let home = std::env::var("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(|value| std::path::PathBuf::from(value).join(".claude")))
        .map_err(|_| "无法定位 Claude 技能目录".to_string())?;
    let root = home.join("skills");
    if !root.exists() { return Ok(Vec::new()); }
    let entries = std::fs::read_dir(root).map_err(|error| format!("读取技能目录失败：{error}"))?;
    let mut skills = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path().join("SKILL.md");
        let Ok(source) = std::fs::read_to_string(path) else { continue };
        let mut name = entry.file_name().to_string_lossy().to_string();
        let mut description = String::new();
        if source.trim_start().starts_with("---") {
            for line in source.trim_start().lines().skip(1).take_while(|line| line.trim() != "---") {
                if let Some(value) = line.strip_prefix("name:") { name = value.trim().trim_matches(['\'', '"']).to_string(); }
                if let Some(value) = line.strip_prefix("description:") { description = value.trim().trim_matches(['\'', '"']).to_string(); }
            }
        }
        if !name.is_empty() { skills.push(LocalSkill { name, description }); }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 不给子进程开控制台窗口；见文件头第 3 条
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 从 Rust 推给前端的事件。前端按 `kind` 分派。
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentEvent {
    /// 命令行 stdout 的一整行（NDJSON，由前端解析）
    Line { line: String },
    /// 进程失败时的诊断；成功进程的 stderr 可能只是警告。
    Err { message: String },
    /// 进程退出。`code` 为 None 表示被信号杀掉（比如用户点了「停止」）
    Done { code: Option<i32> },
}

fn process_error(code: Option<i32>, stderr: &str) -> Option<String> {
    match code {
        Some(value) if value != 0 => Some(if stderr.trim().is_empty() {
            format!("Claude Code 进程异常退出（退出码 {value}），请重试。")
        } else {
            stderr.trim().to_string()
        }),
        _ => None,
    }
}

#[cfg(test)]
mod diagnostic_tests {
    use super::process_error;

    #[test]
    fn successful_reply_can_have_model_diagnostics() {
        assert_eq!(process_error(Some(0), "[claude-code:unrecognized_model] {\"model\":\"deepseek-v4-flash[1m]\"}"), None);
        assert_eq!(process_error(None, "cancelled"), None);
    }

    #[test]
    fn failed_process_preserves_diagnostics_or_reports_exit_code() {
        assert_eq!(process_error(Some(1), " authentication failed\n"), Some("authentication failed".into()));
        assert!(process_error(Some(1), "").unwrap().contains("退出码 1"));
        assert!(process_error(Some(1), "[claude-code:unrecognized_model]").is_some());
    }
}

/// request_id → pid。用来在「停止」和窗口关闭时找到并杀掉对应的进程树。
#[derive(Default)]
pub struct AgentProcessState {
    pids: Mutex<HashMap<String, u32>>,
}

impl AgentProcessState {
    pub(crate) fn has(&self, request_id: &str) -> bool { self.pids.lock().map(|m|m.contains_key(request_id)).unwrap_or(false) }
    pub(crate) fn insert(&self, request_id: &str, pid: u32) {
        if let Ok(mut map) = self.pids.lock() {
            map.insert(request_id.to_string(), pid);
        }
    }

    pub(crate) fn remove(&self, request_id: &str) {
        if let Ok(mut map) = self.pids.lock() {
            map.remove(request_id);
        }
    }

    /// 窗口销毁时兜底清场，防止面板/窗口关了还有 node.exe 留在后台烧 token。
    pub fn kill_all(&self) {
        let pids: Vec<u32> = match self.pids.lock() {
            Ok(mut map) => map.drain().map(|(_, pid)| pid).collect(),
            Err(_) => return,
        };
        for pid in pids {
            kill_pid_tree(pid);
        }
    }
}

/// 树杀。`/T` 是关键：带走路 cmd.exe spawn 出来的 node.exe 孙子进程。
pub(crate) fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

/// 发一条消息并流式收取回复。
#[tauri::command]
pub async fn detect_agent_cli_path() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut directories = Vec::new();
        if let Some(path) = std::env::var_os("PATH") {
            directories.extend(std::env::split_paths(&path));
        }
        // GUI applications may inherit an older PATH than a newly installed CLI.
        if let Some(home) = std::env::var_os("USERPROFILE") {
            directories.push(std::path::PathBuf::from(&home).join(".local").join("bin"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            directories.push(std::path::PathBuf::from(appdata).join("npm"));
        }
        #[cfg(windows)]
        let names = ["claude.exe", "claude.cmd", "claude.bat"];
        #[cfg(not(windows))]
        let names = ["claude"];
        for directory in directories {
            if !directory.is_absolute() { continue; }
            for name in names {
                let candidate = directory.join(name);
                if candidate.is_file() {
                    return Some(candidate.to_string_lossy().into_owned());
                }
            }
        }
        None
    }).await.map_err(|err| format!("检测 Claude Code 失败: {err}"))
}

/// 发一条消息并流式收取回复。
///
/// 事件顺序固定为「若干 Line → (可选 Err) → Done」，前端据此判断这一轮结束。
#[tauri::command]
pub async fn agent_send(
    app: AppHandle,
    state: State<'_, AgentProcessState>,
    request_id: String,
    // `input` 是前端 `buildAgentInputLine` 拼好的一整行 JSONL。Rust 不解析、不改写，
    // 原样写进 stdin —— 转义交给 JS 的 `JSON.stringify`，这是最不容易出错的分工。
    input: String,
    session_id: String,
    resume: bool,
    cli_path: String,
    system_prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    permission: Option<String>,
    on_event: Channel<AgentEvent>,
) -> Result<(), String> {
    let cli = if cli_path.trim().is_empty() {
        "claude".to_string()
    } else {
        cli_path.trim().to_string()
    };

    // 中性工作目录：避开项目里的 CLAUDE.md，别让画布的智能体莫名继承一堆项目指令
    let work_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位数据目录：{err}"))?
        .join("agent");
    std::fs::create_dir_all(&work_dir).map_err(|err| format!("创建智能体目录失败：{err}"))?;

    // 系统提示词落文件：它里面有节点标题/参数，可能带引号和换行，走命令行必炸
    let has_system_prompt = !system_prompt.trim().is_empty();
    let prompt_key: String = request_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(80).collect();
    let system_prompt_file = work_dir.join(format!("system-prompt-{prompt_key}.txt"));
    if has_system_prompt {
        std::fs::write(&system_prompt_file, &system_prompt)
            .map_err(|err| format!("写入系统提示词失败：{err}"))?;
    }

    let mut command = crate::codex_agent::cli_command(&cli)?;
    command.arg("-p");
    command.arg("--output-format").arg("stream-json");
    command.arg("--verbose");
    command.arg("--include-partial-messages");
    // 输入格式：一行 JSONL（content blocks），图片作为 base64 block 走这条路
    command.arg("--input-format").arg("stream-json");
    // 非交互会话预批准实际技能执行需要的工具，保留正常权限机制。
    command.arg("--tools").arg("default");
    command.arg("--permission-mode").arg(if permission.as_deref() == Some("readOnly") {"plan"} else {"acceptEdits"});
    if let Some(model)=model.filter(|v|!v.trim().is_empty()){command.arg("--model").arg(model);}
    command.arg("--allowedTools").arg("Skill,Read,Glob,Grep,Write,Edit,Bash,PowerShell,WebFetch,WebSearch,Agent,Task,TodoWrite");
    if has_system_prompt {
        command.arg("--append-system-prompt-file").arg(&system_prompt_file);
    }
    if resume {
        command.arg("--resume").arg(&session_id);
    } else {
        command.arg("--session-id").arg(&session_id);
    }
    let cwd = cwd.filter(|v| !v.trim().is_empty()).map(std::path::PathBuf::from).unwrap_or(work_dir.clone());
    if !cwd.is_absolute() || !cwd.is_dir(){return Err("工作目录不存在，请重新选择".into());}
    command.current_dir(&cwd);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|err| format!("启动 Claude Code 失败：{err}"))?;
    let pid = child.id();
    state.insert(&request_id, pid);

    // 输入从 stdin 送：长文本、引号、换行都不必转义，也没有命令行长度上限。
    // stream-json 按行读，所以末尾必须补一个换行，否则最后一行不被认作完整消息。
    let mut stdin = child.stdin.take().ok_or("无法写入 Claude Code 的输入")?;
    let stdin_writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
        let _ = stdin.write_all(b"\n");
        let _ = stdin.flush();
        // stdin 在此 drop —— claude 只有读到 EOF 才认为输入结束、开始干活
    });

    let stdout = child.stdout.take().ok_or("无法读取 Claude Code 的输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 Claude Code 的错误输出")?;

    let stderr_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf);
        buf
    });

    let line_channel = on_event.clone();
    let stdout_reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(text) => {
                    // 前端已经关掉 Channel（组件卸载/取消）时就别再读了
                    if line_channel.send(AgentEvent::Line { line: text }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // wait() 是阻塞调用，扔进 blocking 池，别堵住 async 运行时
    let wait_result = tauri::async_runtime::spawn_blocking(move || child.wait()).await;
    let code = wait_result
        .ok()
        .and_then(|result| result.ok())
        .and_then(|status| status.code());

    let _ = stdin_writer.join();
    let _ = stdout_reader.join();
    let stderr_text = stderr_reader.join().unwrap_or_default();

    state.remove(&request_id);

    // stderr 也是 CLI 的诊断通道，不能仅凭有输出就判定请求失败。
    // 模型别名等警告可以伴随正常回复；真实失败仍由退出码和 result.is_error 判断。
    if let Some(message) = process_error(code, &stderr_text) {
        let _ = on_event.send(AgentEvent::Err {
            message,
        });
    }
    let _ = std::fs::remove_file(&system_prompt_file);
    let _ = on_event.send(AgentEvent::Done { code });
    Ok(())
}

/// 用户点「停止」。杀掉整棵进程树后，[`agent_send`] 里的 `wait()` 会返回，
/// 正常走完后面的收尾并给前端补一个 `Done`。
#[tauri::command]
pub fn agent_cancel(
    state: State<'_, AgentProcessState>,
    request_id: String,
) -> Result<(), String> {
    let pid = {
        let mut map = state
            .pids
            .lock()
            .map_err(|_| "进程表锁定失败".to_string())?;
        map.remove(&request_id)
    };
    if let Some(pid) = pid {
        kill_pid_tree(pid);
    }
    Ok(())
}
