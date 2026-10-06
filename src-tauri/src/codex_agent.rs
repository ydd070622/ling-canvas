use std::{collections::{HashMap,VecDeque}, io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, mpsc}, time::Duration};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, ipc::Channel};
use crate::agent::{AgentEvent, AgentProcessState, kill_pid_tree};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Default)]
pub struct CodexBridgeState {
    writers: Mutex<HashMap<String, Arc<Mutex<Option<ChildStdin>>>>>,
    runtime: Mutex<Option<(String, std::path::PathBuf, Connection)>>,
}
impl CodexBridgeState {
    fn connect<'a>(&'a self, path:&str, cwd:&std::path::Path)->Result<std::sync::MutexGuard<'a,Option<(String,std::path::PathBuf,Connection)>>,String> {
        let mut runtime=self.runtime.try_lock().map_err(|_|"Codex 正在处理请求，请稍后重试")?;
        let reusable=runtime.as_mut().is_some_and(|(p,d,c)|p==path && d==cwd && c.child.try_wait().ok()==Some(None));
        if !reusable { runtime.take(); *runtime=Some((path.into(),cwd.into(),Connection::start(path,cwd)?)); }
        Ok(runtime)
    }
    pub fn shutdown(&self) { if let Ok(mut runtime)=self.runtime.try_lock(){runtime.take();} }
}
// Resolve the official npm layout without executing or interpreting its wrapper script.
fn native_codex_path(path:&str)->String {
    let entry=std::path::Path::new(path);
    if entry.file_name().is_some_and(|n|n.to_string_lossy().eq_ignore_ascii_case("codex.cmd") || n.to_string_lossy().eq_ignore_ascii_case("codex.ps1")) {
        if let Some(parent)=entry.parent() {
            for relative in [
                "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
                "node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe",
                "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe",
            ] { let candidate=parent.join(relative); if candidate.is_file(){return candidate.to_string_lossy().into();} }
        }
    }
    path.into()
}
fn resolve_codex_path(path:&str)->String {
    native_codex_path(path)
}
pub(crate) fn cli_command(path: &str) -> Result<Command, String> {
    if path.contains(['"', '\n', '\r', '&', '|', '<', '>', '^', '%', '!']) { return Err("程序路径包含不支持的字符".into()); }
    #[cfg(windows)]
    let mut command = if path.ends_with(".cmd") || path.ends_with(".bat") || !path.contains(['/', '\\']) { let mut c=Command::new("cmd"); c.args(["/d", "/c", path]); c } else { Command::new(path) };
    #[cfg(not(windows))]
    let mut command=Command::new(path);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    Ok(command)
}
pub(crate) fn detect_path(provider: &str) -> Option<String> {
    let mut directories:Vec<_>=std::env::var_os("PATH").map(|p|std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home)=std::env::var_os("USERPROFILE") { directories.push(std::path::PathBuf::from(home).join(".local/bin")); }
    if let Some(home)=std::env::var_os("APPDATA") { directories.push(std::path::PathBuf::from(home).join("npm")); }
    for dir in directories { if !dir.is_absolute(){continue;} for suffix in [".exe", ".cmd", ".bat", ""] { let p=dir.join(format!("{provider}{suffix}")); if p.is_file(){return Some(p.to_string_lossy().into());} } } None
}
fn write(writer:&Arc<Mutex<Option<ChildStdin>>>, value:Value)->Result<(),String> {
    let mut stream=writer.lock().map_err(|_|"输入通道已关闭")?;
    let stream=stream.as_mut().ok_or("输入通道已关闭")?;
    writeln!(stream,"{value}").and_then(|_|stream.flush()).map_err(|e|e.to_string())
}
struct Connection { child:Child, writer:Arc<Mutex<Option<ChildStdin>>>, receiver:mpsc::Receiver<Value>, buffered:Mutex<VecDeque<Value>>, next_id:std::sync::atomic::AtomicU64, stderr_category:Arc<Mutex<String>> }
impl Drop for Connection {
    fn drop(&mut self){
        if let Ok(mut writer)=self.writer.lock(){writer.take();}
        for _ in 0..30 { if self.child.try_wait().ok().flatten().is_some(){return;} std::thread::sleep(Duration::from_millis(100)); }
        kill_pid_tree(self.child.id()); let _=self.child.wait();
    }
}
impl Connection {
    fn start(path:&str,cwd:&std::path::Path)->Result<Self,String>{
        let native_path=native_codex_path(path);
        let mut cmd=cli_command(&native_path)?;cmd.args(["app-server","--listen","stdio://"]).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        // Do not inherit a parent desktop conversation identity into this independent host.
        cmd.env_remove("CODEX_THREAD_ID");
        let mut child=cmd.spawn().map_err(|e|format!("启动 Codex 失败：{e}"))?;
        let writer=Arc::new(Mutex::new(Some(child.stdin.take().ok_or("无法写入 Codex")?)));
        let stdout=child.stdout.take().ok_or("无法读取 Codex")?;
        let stderr=child.stderr.take().ok_or("无法读取 Codex 错误通道")?;
        let stderr_category=Arc::new(Mutex::new(String::new()));
        let category=stderr_category.clone();
        std::thread::spawn(move||{
            use std::io::Read;
            let mut reader=BufReader::new(stderr); let mut bytes=[0u8;4096];
            while let Ok(n)=reader.read(&mut bytes) {if n==0{break;} let text=String::from_utf8_lossy(&bytes[..n]).to_lowercase();
                let reason=if text.contains("config") && (text.contains("parse") || text.contains("invalid")){"配置文件无法解析"}else if text.contains("unauthorized") || text.contains("authentication"){"登录认证失败"}else if text.contains("permission denied") || text.contains("access is denied"){"程序或工作目录访问被拒绝"}else if text.contains("unrecognized") || text.contains("unexpected argument"){"CLI 版本不支持当前启动参数"}else{""};
                if !reason.is_empty(){if let Ok(mut c)=category.lock(){*c=reason.into();}}
            }
        });
        let (sender,receiver)=mpsc::channel();
        std::thread::spawn(move||{for line in BufReader::new(stdout).lines(){let Ok(line)=line else{break};if let Ok(value)=serde_json::from_str::<Value>(&line){if sender.send(value).is_err(){break;}}}});
        let connection=Self{child,writer,receiver,buffered:Mutex::new(VecDeque::new()),next_id:std::sync::atomic::AtomicU64::new(1),stderr_category};
        connection.rpc(1,"initialize",json!({"clientInfo":{"name":"ling_canvas","title":"Ling Canvas","version":"2.0.10"},"capabilities":{"experimentalApi":true}}))?;
        write(&connection.writer,json!({"method":"initialized"}))?;Ok(connection)
    }
    fn rpc(&self,_id:u64,method:&str,params:Value)->Result<Value,String>{
        let id=self.next_id.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
        write(&self.writer,json!({"id":id,"method":method,"params":params}))?;
        let deadline=std::time::Instant::now()+Duration::from_secs(30);
        loop {let value=self.receiver.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())).map_err(|error|{
            let stage=match method{"initialize"=>"连接初始化","account/read"=>"登录检测","model/list"=>"模型列表加载","skills/list"=>"技能列表加载","thread/start"|"thread/resume"=>"对话连接","turn/start"=>"发送消息",_=>method};
            let reason=if matches!(error,mpsc::RecvTimeoutError::Timeout){"响应超时"}else{"进程已退出"};
            let detail=self.stderr_category.lock().ok().map(|s|s.clone()).unwrap_or_default();
            format!("Codex {stage}失败：{reason}{}",if detail.is_empty(){String::new()}else{format!("（{detail}）")})
        })?;
            if value["id"]==id {if !value["error"].is_null(){return Err(value["error"]["message"].as_str().unwrap_or("Codex 请求失败").into());}return Ok(value["result"].clone());}
            self.buffered.lock().map_err(|_|"事件队列已关闭")?.push_back(value);
        }
    }
}
fn work_directory(app:&AppHandle,cwd:&str)->Result<std::path::PathBuf,String>{
    let path=if cwd.trim().is_empty(){app.path().app_data_dir().map_err(|e|e.to_string())?.join("agent")}else{std::path::PathBuf::from(cwd)};
    if !path.is_absolute(){return Err("工作目录必须是绝对路径".into());}
    if cwd.trim().is_empty(){std::fs::create_dir_all(&path).map_err(|e|e.to_string())?;}
    if !path.is_dir(){return Err("工作目录不存在，请重新选择".into());}Ok(path)
}
fn skill_metadata(source:&str)->Option<(String,String)> {
    let source=source.trim_start_matches('\u{feff}').trim_start();
    if !source.starts_with("---"){return None;}
    let mut name=String::new();let mut description=String::new();let mut multiline=false;
    for line in source.lines().skip(1).take_while(|line|line.trim()!="---") {
        if let Some(value)=line.strip_prefix("name:"){name=value.trim().trim_matches(['\'', '"']).into();multiline=false;}
        else if let Some(value)=line.strip_prefix("description:"){
            let value=value.trim();multiline=matches!(value,">"|"|"|">-"|"|-"|">+"|"|+");
            if !multiline{description=value.trim_matches(['\'', '"']).into();}
        }else if multiline && (line.starts_with(' ') || line.starts_with('\t')){
            if !description.is_empty(){description.push(' ');}description.push_str(line.trim());
        }else if !line.trim().is_empty(){multiline=false;}
    }
    if name.is_empty(){None}else{Some((name,description))}
}
fn read_personal_skills(root:&std::path::Path,depth:usize,out:&mut Vec<Value>) {
    if depth>4{return;}
    let file=root.join("SKILL.md");
    if let Ok(source)=std::fs::read_to_string(&file){
        if let Some((name,description))=skill_metadata(&source){out.push(json!({"name":name,"description":description,"path":file,"scope":"user"}));}
        return;
    }
    if let Ok(entries)=std::fs::read_dir(root){for entry in entries.flatten(){
        if entry.file_name().to_string_lossy().starts_with('.') {continue;}
        if entry.path().is_dir(){read_personal_skills(&entry.path(),depth+1,out);}
    }}
}
fn merge_skills(personal:Vec<Value>,runtime:Vec<Value>,disabled:&[String])->Vec<Value> {
    let mut skills=Vec::new();let mut names=std::collections::HashSet::new();
    for mut skill in personal.into_iter().chain(runtime){
        let name=skill["name"].as_str().unwrap_or("").to_string();
        if name.is_empty() || disabled.iter().any(|path|skill["path"].as_str()==Some(path.as_str())) || !names.insert(name.clone()){continue;}
        skill["displayName"]=json!(name.rsplit(':').next().unwrap_or(&name));skills.push(skill);
    }
    skills.sort_by_key(|skill|{
        let priority=match skill["scope"].as_str(){Some("user")=>0,Some("repo")=>1,Some("system")=>3,_=>2};
        (priority,skill["displayName"].as_str().unwrap_or("").to_lowercase())
    });skills
}
#[tauri::command]
pub async fn probe_local_agent(app:AppHandle,provider:String,cli_path:String,cwd:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||{
        if !["claude","codex"].contains(&provider.as_str()){return Err("不支持的智能体".into());}
        let path=if cli_path.trim().is_empty(){detect_path(&provider).ok_or(format!("未找到 {provider}，请安装或手动选择程序"))?}else{cli_path};
        let dir=work_directory(&app,&cwd)?;
        if provider=="codex"{
            let path=resolve_codex_path(&path);
            let state=app.state::<CodexBridgeState>();
            // Re-detection also picks up an upgraded CLI at the same executable path.
            state.shutdown();
            let mut runtime=state.connect(&path,&dir)?;
            let c=&runtime.as_ref().ok_or("Codex 未连接")?.2;
            let result=(||->Result<Value,String>{
            let account=c.rpc(2,"account/read",json!({"refreshToken":false}))?;
            let logged=!account["account"].is_null() || account["requiresOpenaiAuth"]==false;
            Ok(json!({"path":path,"loggedIn":logged,"status":if logged{"已连接 · 已登录"}else{"已安装 · 尚未登录，请先运行 codex login"}}))
            })();
            if result.is_err(){runtime.take();}result
        } else {
            let version=run_cli(&path,&["--version"],&dir)?;
            let auth=run_cli(&path,&["auth","status","--json"],&dir).ok().and_then(|s|serde_json::from_str::<Value>(&s).ok());
            let logged=auth.as_ref().and_then(|v|v["loggedIn"].as_bool());
            Ok(json!({"path":path,"version":version.trim(),"loggedIn":logged,"status":match logged{Some(true)=>"已连接 · 已登录",Some(false)=>"已安装 · 尚未登录，请先运行 claude auth login",None=>"已安装 · 登录状态无法确认"},"models":[],"skills":[]}))
        }
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn codex_capabilities(app:AppHandle,cli_path:String,cwd:String,scope:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let path=resolve_codex_path(&if cli_path.is_empty(){detect_path("codex").ok_or("未找到 Codex")?}else{cli_path});
        let dir=work_directory(&app,&cwd)?;
        let state=app.state::<CodexBridgeState>(); let mut runtime=state.connect(&path,&dir)?;
        let c=&runtime.as_ref().ok_or("Codex 未连接")?.2;
        let result=(||->Result<Value,String>{
            if scope=="models" {
                let mut models=Vec::new(); let mut cursor=Value::Null;
                loop {let page=c.rpc(0,"model/list",json!({"cursor":cursor}))?;
                    models.extend(page["data"].as_array().into_iter().flatten().filter(|m|m["hidden"]!=true).map(|m|json!({"id":m["model"],"name":m["displayName"],"isDefault":m["isDefault"]})));
                    let next=page["nextCursor"].clone();if next.is_null() || next==cursor{break;}cursor=next;
                }
                Ok(json!({"models":models}))
            }else if scope=="skills"{
                let skills=c.rpc(0,"skills/list",json!({"cwds":[dir],"forceReload":true}))?;
                let entries:Vec<&Value>=skills["data"].as_array().into_iter().flatten().flat_map(|entry|entry["skills"].as_array().into_iter().flatten()).collect();
                let disabled:Vec<String>=entries.iter().filter(|s|s["enabled"]==false).filter_map(|s|s["path"].as_str().map(String::from)).collect();
                let runtime:Vec<Value>=entries.into_iter().filter(|s|s["enabled"]!=false).map(|s|json!({"name":s["name"],"description":s["description"],"path":s["path"],"scope":s["scope"]})).collect();
                let mut personal=Vec::new();
                if let Some(home)=std::env::var_os("USERPROFILE") {
                    let home=std::path::PathBuf::from(home);
                    let codex_home=std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(||home.join(".codex"));
                    read_personal_skills(&codex_home.join("skills"),0,&mut personal);
                    read_personal_skills(&home.join(".agents/skills"),0,&mut personal);
                }
                let skills=merge_skills(personal,runtime,&disabled);
                Ok(json!({"skills":skills}))
            }else{Err("不支持的 Codex 能力类型".into())}
        })();
        if result.is_err(){runtime.take();}result
    }).await.map_err(|e|e.to_string())?
}
fn run_cli(path:&str,args:&[&str],cwd:&std::path::Path)->Result<String,String>{
    let mut c=cli_command(path)?;c.args(args).current_dir(cwd).stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    let mut child=c.spawn().map_err(|e|e.to_string())?;let stdout=child.stdout.take().ok_or("无法读取程序输出")?;
    let reader=std::thread::spawn(move||{use std::io::Read;let mut s=String::new();let _=BufReader::new(stdout).read_to_string(&mut s);s});
    for _ in 0..150 {if let Some(status)=child.try_wait().map_err(|e|e.to_string())?{let out=reader.join().unwrap_or_default();return if status.success(){Ok(out)}else{Err("程序检测失败".into())};}std::thread::sleep(Duration::from_millis(100));}
    kill_pid_tree(child.id());let _=child.wait();let _=reader.join();Err("程序检测超时".into())
}
#[tauri::command]
pub fn codex_respond(state:State<'_,CodexBridgeState>,request_id:String,rpc_id:Value,result:Value)->Result<(),String>{
    let writer=state.writers.lock().map_err(|_|"通道已关闭")?.get(&request_id).cloned().ok_or("任务已结束")?;
    write(&writer,json!({"id":rpc_id,"result":result}))
}
#[tauri::command]
pub async fn codex_send(app:AppHandle,request_id:String,input:Value,session_id:String,resume:bool,cli_path:String,system_prompt:String,cwd:String,model:String,permission:String,on_event:Channel<AgentEvent>)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        let dir=work_directory(&app,&cwd)?;let path=if cli_path.is_empty(){detect_path("codex").ok_or("未找到 Codex，请在设置中检测程序")?}else{cli_path};
        let path=resolve_codex_path(&path);
        let bridge=app.state::<CodexBridgeState>();let mut runtime=bridge.connect(&path,&dir)?;
        let connection=&runtime.as_ref().ok_or("Codex 未连接")?.2;
        let processes=app.state::<AgentProcessState>();processes.insert(&request_id,connection.child.id());
        bridge.writers.lock().map_err(|_|"通道已关闭")?.insert(request_id.clone(),connection.writer.clone());
        let run=||->Result<(),String>{
            let mut params=json!({"cwd":dir,"approvalPolicy":"on-request","approvalsReviewer":"user","sandbox":if permission=="readOnly"{"read-only"}else{"workspace-write"},"developerInstructions":system_prompt});
            if !model.is_empty(){params["model"]=json!(model);}
            if resume{params["threadId"]=json!(session_id);}
            let thread=connection.rpc(2,if resume{"thread/resume"}else{"thread/start"},params)?;
            let thread_id=thread["thread"]["id"].as_str().ok_or("未收到 Codex 对话标识")?;
            on_event.send(AgentEvent::Line{line:json!({"type":"system","subtype":"init","session_id":thread_id}).to_string()}).map_err(|e|e.to_string())?;
            let turn=connection.rpc(3,"turn/start",json!({"threadId":thread_id,"input":input}))?;
            let turn_id=turn["turn"]["id"].as_str();
            loop {
                let pending=connection.buffered.lock().map_err(|_|"事件队列已关闭")?.pop_front();
                let value=if let Some(v)=pending{v}else{match connection.receiver.recv_timeout(Duration::from_secs(1)){Ok(v)=>v,Err(mpsc::RecvTimeoutError::Timeout)=>{if app.state::<AgentProcessState>().has(&request_id){continue;}return Ok(());},Err(_)=>{if !app.state::<AgentProcessState>().has(&request_id){return Ok(());}return Err("Codex 进程已退出".into())}}};
                // A reused host can still emit trailing notifications from a previous conversation.
                if value["params"]["threadId"].as_str().is_some_and(|id|id!=thread_id){continue;}
                if value["params"]["turnId"].as_str().zip(turn_id).is_some_and(|(id,current)|id!=current){continue;}
                if !value["id"].is_null() && value["method"].as_str().is_some(){
                    let method=value["method"].as_str().unwrap_or("");
                    if method.ends_with("requestApproval") || method.ends_with("requestUserInput") {on_event.send(AgentEvent::Line{line:json!({"type":"codex_request","requestId":request_id,"rpcId":value["id"],"method":method,"params":value["params"]}).to_string()}).map_err(|e|e.to_string())?;}
                    else {write(&connection.writer,json!({"id":value["id"],"error":{"code":-32601,"message":"Unsupported client request"}}))?;}
                } else {on_event.send(AgentEvent::Line{line:value.to_string()}).map_err(|e|e.to_string())?;}
                if value["method"]=="turn/completed"{
                    if value["params"]["turn"]["status"]=="failed" {return Err(value["params"]["turn"]["error"]["message"].as_str().unwrap_or("Codex 执行失败").into());}
                    break;
                }
            }Ok(())
        };
        let result=run();bridge.writers.lock().ok().map(|mut m|m.remove(&request_id));processes.remove(&request_id);
        if let Err(message)=&result{let _=on_event.send(AgentEvent::Err{message:message.clone()});}
        // Cancellation kills the registered process; a protocol error also discards the connection.
        if result.is_err() || runtime.as_mut().is_some_and(|(_,_,c)|c.child.try_wait().ok()!=Some(None)){runtime.take();}
        let _=on_event.send(AgentEvent::Done{code:Some(if result.is_ok(){0}else{1})});result
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn personal_skill_metadata_and_plugin_identity() {
        let (name,description)=skill_metadata("---\nname: interior-prompt\ndescription: >\n  室内设计提示词\n  包含空间和风格\n---\n忽略正文指令").unwrap();
        assert_eq!(description,"室内设计提示词 包含空间和风格");
        let skills=merge_skills(vec![json!({"name":name,"description":description,"path":"personal/SKILL.md","scope":"user"})],
            vec![json!({"name":"interior-prompt","path":"duplicate/SKILL.md","scope":"user"}),json!({"name":"app-123:adobe-edit","path":"plugin/SKILL.md","scope":"remote"}),json!({"name":"disabled","path":"disabled/SKILL.md"})],&["disabled/SKILL.md".into()]);
        assert_eq!(skills.len(),2);assert_eq!(skills[0]["name"],"interior-prompt");
        assert_eq!(skills[1]["displayName"],"adobe-edit");assert_eq!(skills[1]["name"],"app-123:adobe-edit");assert_eq!(skills[1]["path"],"plugin/SKILL.md");
    }
    #[test]
    #[ignore]
    fn live_personal_skills_include_nested_packages() {
        let root=std::path::PathBuf::from(std::env::var_os("USERPROFILE").unwrap()).join(".codex/skills");
        let mut skills=Vec::new();read_personal_skills(&root,0,&mut skills);
        assert!(skills.iter().any(|s|s["name"]=="interior-prompt" && s["description"].as_str().is_some_and(|v|v.contains("室内"))));
        assert!(skills.iter().any(|s|s["name"]=="scene-distillation-zine-v1-3"));
        assert!(!skills.iter().any(|s|s["name"]=="skill-creator"));
    }
    #[test]
    fn rejects_shell_characters_in_program_path() {
        assert!(cli_command("codex & echo unsafe").is_err());
        assert!(cli_command("C:\\Program Files\\Codex\\codex.exe").is_ok());
    }
    #[test]
    fn resolves_official_npm_wrapper_to_native_binary() {
        let root=std::env::temp_dir().join(format!("ling-codex-resolver-{}",std::process::id()));
        let binary=root.join("node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();std::fs::write(&binary,[]).unwrap();
        assert_eq!(std::path::PathBuf::from(native_codex_path(root.join("codex.cmd").to_str().unwrap())),binary);
        assert_eq!(native_codex_path("C:/custom/my-codex.exe"),"C:/custom/my-codex.exe");
        std::fs::remove_file(&binary).unwrap();
        // Leave only empty temporary directories; no recursive deletion of computed paths.
    }
    #[test]
    #[ignore]
    fn live_codex_reuses_connection_and_recovers_exit() {
        let path=native_codex_path(&detect_path("codex").unwrap());
        let cwd=std::env::current_dir().unwrap();let state=CodexBridgeState::default();
        let first_pid={let runtime=state.connect(&path,&cwd).unwrap();let c=&runtime.as_ref().unwrap().2;
            assert!(c.rpc(0,"account/read",json!({"refreshToken":false})).unwrap()["requiresOpenaiAuth"].is_boolean());c.child.id()};
        {let runtime=state.connect(&path,&cwd).unwrap();let c=&runtime.as_ref().unwrap().2;
            assert_eq!(c.child.id(),first_pid);
            assert!(c.rpc(0,"model/list",json!({})).unwrap()["data"].is_array());
            assert!(c.rpc(0,"skills/list",json!({"cwds":[cwd],"forceReload":true})).unwrap()["data"].is_array());}
        {let mut runtime=state.runtime.lock().unwrap();let c=&mut runtime.as_mut().unwrap().2;c.child.kill().unwrap();c.child.wait().unwrap();}
        {let runtime=state.connect(&path,&cwd).unwrap();let c=&runtime.as_ref().unwrap().2;
            assert_ne!(c.child.id(),first_pid);
            assert!(c.rpc(0,"account/read",json!({"refreshToken":false})).unwrap()["requiresOpenaiAuth"].is_boolean());}
        state.shutdown();assert!(state.runtime.lock().unwrap().is_none());
    }
    // Explicit opt-in; contacts the locally configured Codex model only for a tiny connectivity check.
    #[test]
    #[ignore]
    fn live_codex_metadata_and_resume() {
        let path=detect_path("codex").unwrap();
        let cwd=std::env::current_dir().unwrap();
        let connection=Connection::start(&path,&cwd).unwrap();
        assert!(connection.rpc(2,"account/read",json!({"refreshToken":false})).unwrap()["requiresOpenaiAuth"].is_boolean());
        assert!(connection.rpc(3,"model/list",json!({})).unwrap()["data"].is_array());
        assert!(connection.rpc(4,"skills/list",json!({"cwds":[cwd],"forceReload":true})).unwrap()["data"].is_array());
        let existing=connection.rpc(5,"thread/list",json!({"cwd":cwd,"limit":10})).unwrap();
        let id=existing["data"].as_array().unwrap().first().expect("prior test thread available")["id"].as_str().unwrap().to_string();
        drop(connection);
        let resumed=Connection::start(&path,&cwd).unwrap();
        assert_eq!(resumed.rpc(2,"thread/resume",json!({"threadId":id})).unwrap()["thread"]["id"],id);
    }
    #[test]
    #[ignore]
    fn live_codex_roundtrip_and_resume() {
        let path=detect_path("codex").expect("Codex installed");
        let cwd=std::env::current_dir().unwrap();
        let connection=Connection::start(&path,&cwd).unwrap();
        let account=connection.rpc(2,"account/read",json!({"refreshToken":false})).unwrap();
        assert!(!account["account"].is_null() || account["requiresOpenaiAuth"]==false);
        let models=connection.rpc(3,"model/list",json!({})).unwrap();
        assert!(models["data"].is_array());
        let model=models["data"].as_array().unwrap().iter().find(|m|m["model"].as_str().is_some_and(|id|id == "gpt-5.4")).or_else(||models["data"].as_array().unwrap().first()).unwrap()["model"].as_str().unwrap();
        let skills=connection.rpc(4,"skills/list",json!({"cwds":[cwd],"forceReload":true})).unwrap();
        assert!(skills["data"].is_array());
        let thread=connection.rpc(5,"thread/start",json!({"cwd":cwd,"model":model,"sandbox":"read-only","approvalPolicy":"on-request","approvalsReviewer":"user","developerInstructions":"仅测试对话连通性，不使用任何工具，也不修改文件。"})).unwrap();
        let id=thread["thread"]["id"].as_str().unwrap().to_string();
        connection.rpc(6,"turn/start",json!({"threadId":id,"input":[{"type":"text","text":"仅回复：连通测试通过。","text_elements":[]}]})).unwrap();
        let mut reply=String::new();
        loop {
            let value=connection.receiver.recv_timeout(Duration::from_secs(90)).unwrap();
            if value["method"]=="item/agentMessage/delta"{reply.push_str(value["params"]["delta"].as_str().unwrap_or(""));}
            if value["method"]=="turn/completed" { assert_eq!(value["params"]["turn"]["status"],"completed", "{}", value["params"]["turn"]["error"]["message"].as_str().unwrap_or("unknown error")); break; }
        }
        assert!(!reply.is_empty(),"received streamed response");
        drop(connection);
        let resumed=Connection::start(&path,&cwd).unwrap();
        let thread=resumed.rpc(2,"thread/resume",json!({"threadId":id,"cwd":cwd,"sandbox":"read-only","approvalPolicy":"on-request","approvalsReviewer":"user"})).unwrap();
        assert_eq!(thread["thread"]["id"],id);
    }
}
