use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
mod local_space;
use tokio::sync::oneshot;

mod agent;
mod codex_agent;

const MAX_DROPPED_IMAGE_BYTES: u64 = 200 * 1024 * 1024;
/// 单个 multipart 文件上限（参考图/首帧图解码后）
const MAX_MULTIPART_FILE_BYTES: usize = 64 * 1024 * 1024;
/// 上游生成类请求默认超时：文生图/图生视频首包可能等待数分钟
const DEFAULT_HTTP_TIMEOUT_MS: u64 = 300_000;
const MAX_HTTP_TIMEOUT_MS: u64 = 1_800_000;
const DEFAULT_USER_AGENT: &str = "LingCanvas/1.0 (+tauri)";
/// Project documents are deliberately kept separate so one large or damaged
/// canvas cannot prevent the rest of the project list from loading.
const PROJECT_STORAGE_DIR: &str = "projects";
const MEDIA_STORAGE_DIR: &str = "media";
const MAX_PROJECT_DOCUMENT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_MEDIA_DATA_URL_BYTES: usize = 300 * 1024 * 1024;

/// 素材库根目录的出厂默认值。真正的根目录在运行期由 [`AssetRootState`] 持有，
/// 由用户在原生目录选择器里指定——选择动作也发生在 Rust 侧，前端永远拿不到、
/// 也永远不传绝对路径。它仍是素材库命令唯一的安全边界。
const DEFAULT_ASSET_ROOT: &str = r"F:\02-设计素材库";
/// 根目录的持久化文件，落在 app_config_dir() 下
const ASSET_CONFIG_FILE: &str = "asset-library.json";
/// 递归深度上限：实测素材库最深 4 层，留余量防止异常目录树把扫描拖死
const ASSET_MAX_DEPTH: usize = 6;
/// 条目数上限：实测 556 张图；超限时截断并在返回值里标记
const ASSET_MAX_ENTRIES: usize = 20_000;
/// 单个素材文件上限，与 read_local_binary 的 64MB 保持一致
const MAX_ASSET_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// 列表白名单。刻意不含 svg：Chromium 的 createImageBitmap 对 svg blob 常抛错，
/// 放进网格只会得到一列破图。read_asset_file 仍走 guess_binary_mime，
/// 所以老画布引用的 svg 依然读得出来。
const ASSET_IMAGE_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];
/// 素材库根下的元数据目录，必须整棵跳过。
/// Pixcall 的 .pixcall/ 与 Billfish 的 .bf/ 里存着几百张 .preview 缩略图，
/// .pixcall/trash/ 里还有用户删过的原图——不跳过的话网格会被重复图和垃圾填满。
const ASSET_SKIP_DIRS: [&str; 4] = [".bf", ".pixcall", ".pixcall.cache", "$RECYCLE.BIN"];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedImage {
    data_url: String,
    file_name: String,
}

fn project_storage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(PROJECT_STORAGE_DIR))
        .map_err(|err| format!("无法定位项目存储目录: {err}"))
}

fn validate_project_id(project_id: &str) -> Result<(), String> {
    let valid = !project_id.is_empty()
        && project_id.len() <= 160
        && project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err("项目 ID 无效".into())
    }
}

fn project_document_path(dir: &Path, project_id: &str) -> Result<PathBuf, String> {
    validate_project_id(project_id)?;
    Ok(dir.join(format!("{project_id}.json")))
}

static MEDIA_STORAGE_LOCK: Mutex<()> = Mutex::new(());
fn media_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("media-storage.json"))
}
fn media_storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config = media_config_path(app)?;
    if config.exists() {
        let path: String = serde_json::from_slice(&fs::read(config).map_err(|e| e.to_string())?).map_err(|e| format!("图片存储配置无效: {e}"))?;
        return Ok(PathBuf::from(path));
    }
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(MEDIA_STORAGE_DIR))
}
fn copy_media_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    if !source.exists() { return Ok(()); }
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() { return Err("图片目录包含链接，无法迁移".into()); }
        let destination = target.join(entry.file_name());
        if kind.is_dir() { copy_media_tree(&entry.path(), &destination)?; }
        else if kind.is_file() {
            let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
            if destination.exists() {
                if fs::read(&destination).map_err(|e| e.to_string())? != bytes { return Err("目标目录存在同名不同内容的图片，请选择其他文件夹".into()); }
            } else {
                fs::write(&destination, &bytes).map_err(|e| e.to_string())?;
                sync_file(&destination)?;
            }
            if fs::read(&destination).map_err(|e| e.to_string())? != bytes { return Err("迁移校验失败".into()); }
        }
    }
    Ok(())
}
#[tauri::command]
async fn get_media_storage_root(app: tauri::AppHandle) -> Result<String, String> {
    Ok(media_storage_root(&app)?.to_string_lossy().to_string())
}
#[tauri::command]
async fn pick_media_storage_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().set_title("选择原图与预览图存储文件夹").blocking_pick_folder();
        let Some(picked) = picked else { return Ok(None); };
        let selected = picked.into_path().map_err(|e| e.to_string())?;
        let target = selected.join("LingCanvas-media");
        fs::create_dir_all(&target).map_err(|e| format!("无法创建存储文件夹: {e}"))?;
        let target = fs::canonicalize(target).map_err(|e| e.to_string())?;
        let _guard = MEDIA_STORAGE_LOCK.lock().map_err(|_| "图片存储锁不可用".to_string())?;
        let source = media_storage_root(&app)?;
        let source = if source.exists() { fs::canonicalize(source).map_err(|e| e.to_string())? } else { source };
        if source == target { return Ok(Some(target.to_string_lossy().to_string())); }
        if target.starts_with(&source) || source.starts_with(&target) { return Err("新旧存储文件夹不能相互包含".into()); }
        copy_media_tree(&source, &target)?;
        let config = media_config_path(&app)?;
        let temp = config.with_extension("json.tmp");
        let bytes = serde_json::to_vec(&target.to_string_lossy().to_string()).map_err(|e| e.to_string())?;
        fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        sync_file(&temp)?;
        commit_project_temp(&temp, &config, &config.with_extension("json.bak"))?;
        Ok(Some(target.to_string_lossy().to_string()))
    }).await.map_err(|e| e.to_string())?
}

fn media_storage_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let (project_id, media_id) = key
        .split_once(':')
        .ok_or_else(|| "图片存储键无效".to_string())?;
    validate_project_id(project_id)?;
    if media_id.is_empty() || media_id.len() > 240 {
        return Err("图片存储键无效".into());
    }
    let encoded_id = URL_SAFE_NO_PAD.encode(media_id.as_bytes());
    Ok(media_storage_root(app)?.join(project_id).join(format!("{encoded_id}.media")))
}

fn media_key_from_path(project_id: &str, path: &Path) -> Option<String> {
    let encoded = path.file_stem()?.to_str()?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let media_id = String::from_utf8(bytes).ok()?;
    if media_id.is_empty() || media_id.len() > 240 {
        return None;
    }
    Some(format!("{project_id}:{media_id}"))
}

fn is_valid_project_json(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() <= MAX_PROJECT_DOCUMENT_BYTES)
        .unwrap_or(false)
        && fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .is_some()
}

fn sync_file(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(|err| format!("同步项目文件失败 ({}): {err}", path.display()))
}

/// Install a fully-written temporary document.
///
/// `rename(old, backup)` is not reliable for the installed Windows app on all
/// machines (the app can create files but Windows may deny renaming an existing
/// one). Copying the backup first preserves recovery, then we prefer an atomic
/// rename and fall back to an overwrite + fsync when the destination cannot be
/// replaced by rename.
fn commit_project_temp(temp: &Path, target: &Path, backup: &Path) -> Result<(), String> {
    if target.exists() {
        fs::copy(target, backup).map_err(|err| format!("创建项目备份失败: {err}"))?;
    }

    if let Err(rename_error) = fs::rename(temp, target) {
        if !target.exists() {
            return Err(format!("替换项目文件失败: {rename_error}"));
        }
        fs::copy(temp, target).map_err(|copy_error| {
            format!("替换项目文件失败: {copy_error}（重命名错误: {rename_error}）")
        })?;
        sync_file(target)?;
        fs::remove_file(temp).map_err(|err| format!("清理项目临时文件失败: {err}"))?;
    }

    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn recover_project_document_sidecars(dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|err| format!("无法读取项目目录: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("无法读取项目目录项: {err}"))?;
        let path = entry.path();
        if !entry
            .file_type()
            .map_err(|err| format!("无法读取项目文件类型: {err}"))?
            .is_file()
        {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let (base_name, is_temp) = if let Some(base) = name.strip_suffix(".json.tmp") {
            (base, true)
        } else if let Some(base) = name.strip_suffix(".json.bak") {
            (base, false)
        } else {
            continue;
        };
        if validate_project_id(base_name).is_err() {
            continue;
        }
        let target = dir.join(format!("{base_name}.json"));
        let temp = dir.join(format!("{base_name}.json.tmp"));
        let backup = dir.join(format!("{base_name}.json.bak"));

        if is_temp {
            // A synced, valid .tmp is the newest save. This also repairs files
            // left by the first Windows implementation whose rename was denied.
            if is_valid_project_json(&temp) {
                commit_project_temp(&temp, &target, &backup)?;
            }
        } else if !target.exists() && !temp.exists() {
            // No newer temp survived, so restore the last known-good backup.
            fs::rename(&path, &target)
                .map_err(|err| format!("恢复项目文件失败 ({}): {err}", target.display()))?;
        }
    }
    Ok(())
}

fn load_project_documents_from_disk(
    app: &tauri::AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = project_storage_dir(app)?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建项目目录: {err}"))?;
    recover_project_document_sidecars(&dir)?;

    let mut projects = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|err| format!("无法读取项目目录: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("无法读取项目目录项: {err}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = fs::metadata(&path)
            .map_err(|err| format!("无法读取项目文件信息 ({}): {err}", path.display()))?;
        if !metadata.is_file() || metadata.len() > MAX_PROJECT_DOCUMENT_BYTES {
            eprintln!("跳过无效或过大的项目文件: {}", path.display());
            continue;
        }
        let bytes = fs::read(&path)
            .map_err(|err| format!("无法读取项目文件 ({}): {err}", path.display()))?;
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(project) => projects.push(project),
            Err(err) => {
                let backup = path.with_extension("json.bak");
                let recovered = fs::read(&backup)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
                if let Some(project) = recovered {
                    eprintln!("项目文件损坏，已读取备份 {}: {err}", path.display());
                    projects.push(project);
                } else {
                    eprintln!("跳过损坏的项目文件 {}: {err}", path.display());
                }
            }
        }
    }
    Ok(projects)
}

fn write_project_document_to_disk(
    app: &tauri::AppHandle,
    project: serde_json::Value,
) -> Result<(), String> {
    let project_id = project
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "项目缺少有效 ID".to_string())?;
    let dir = project_storage_dir(app)?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建项目目录: {err}"))?;
    let target = project_document_path(&dir, project_id)?;
    let temp = dir.join(format!("{project_id}.json.tmp"));
    let backup = dir.join(format!("{project_id}.json.bak"));
    let bytes = serde_json::to_vec(&project).map_err(|err| format!("无法序列化项目: {err}"))?;
    if bytes.len() as u64 > MAX_PROJECT_DOCUMENT_BYTES {
        return Err("项目文件超过 100MB 限制".into());
    }

    fs::write(&temp, &bytes).map_err(|err| format!("写入项目临时文件失败: {err}"))?;
    sync_file(&temp)?;
    commit_project_temp(&temp, &target, &backup)
}

#[tauri::command]
async fn load_project_documents(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || load_project_documents_from_disk(&app))
        .await
        .map_err(|err| format!("项目读取任务失败: {err}"))?
}

#[tauri::command]
async fn write_project_document(
    app: tauri::AppHandle,
    project: serde_json::Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_project_document_to_disk(&app, project))
        .await
        .map_err(|err| format!("项目写入任务失败: {err}"))?
}

#[tauri::command]
async fn delete_project_documents(
    app: tauri::AppHandle,
    project_ids: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MEDIA_STORAGE_LOCK.lock().map_err(|_| "图片存储锁不可用".to_string())?;
        let dir = project_storage_dir(&app)?;
        fs::create_dir_all(&dir).map_err(|err| format!("无法创建项目目录: {err}"))?;
        for project_id in project_ids {
            let target = project_document_path(&dir, &project_id)?;
            for path in [
                target,
                dir.join(format!("{project_id}.json.tmp")),
                dir.join(format!("{project_id}.json.bak")),
            ] {
                if path.exists() {
                    fs::remove_file(&path)
                        .map_err(|err| format!("删除项目文件失败 ({}): {err}", path.display()))?;
                }
            }
            let media_dir = media_storage_root(&app)?.join(&project_id);
            if media_dir.exists() {
                fs::remove_dir_all(&media_dir)
                    .map_err(|err| format!("删除项目图片失败 ({}): {err}", media_dir.display()))?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("项目删除任务失败: {err}"))?
}

#[tauri::command]
async fn save_canvas_media(
    app: tauri::AppHandle,
    key: String,
    data_url: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MEDIA_STORAGE_LOCK.lock().map_err(|_| "图片存储锁不可用".to_string())?;
        if !data_url.starts_with("data:") || data_url.len() > MAX_MEDIA_DATA_URL_BYTES {
            return Err("图片数据无效或超过 300MB 限制".into());
        }
        let target = media_storage_path(&app, &key)?;
        let parent = target
            .parent()
            .ok_or_else(|| "图片存储路径无效".to_string())?;
        fs::create_dir_all(parent).map_err(|err| format!("无法创建图片目录: {err}"))?;
        let temp = target.with_extension("media.tmp");
        let backup = target.with_extension("media.bak");
        fs::write(&temp, data_url.as_bytes())
            .map_err(|err| format!("写入图片临时文件失败: {err}"))?;
        sync_file(&temp)?;
        commit_project_temp(&temp, &target, &backup)
    })
    .await
    .map_err(|err| format!("图片写入任务失败: {err}"))?
}

#[tauri::command]
async fn load_canvas_media(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MEDIA_STORAGE_LOCK.lock().map_err(|_| "图片存储锁不可用".to_string())?;
        let path = media_storage_path(&app, &key)?;
        if !path.exists() {
            return Ok(None);
        }
        let metadata = fs::metadata(&path).map_err(|err| format!("无法读取图片信息: {err}"))?;
        if !metadata.is_file() || metadata.len() as usize > MAX_MEDIA_DATA_URL_BYTES {
            return Err("图片文件无效或超过 300MB 限制".into());
        }
        fs::read_to_string(&path)
            .map(Some)
            .map_err(|err| format!("读取图片文件失败: {err}"))
    })
    .await
    .map_err(|err| format!("图片读取任务失败: {err}"))?
}

#[tauri::command]
async fn list_canvas_media_keys(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MEDIA_STORAGE_LOCK.lock().map_err(|_| "图片存储锁不可用".to_string())?;
        validate_project_id(&project_id)?;
        let dir = media_storage_root(&app)?.join(&project_id);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut keys = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|err| format!("无法读取图片目录: {err}"))? {
            let entry = entry.map_err(|err| format!("无法读取图片目录项: {err}"))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("media") {
                continue;
            }
            if let Some(key) = media_key_from_path(&project_id, &path) {
                keys.push(key);
            }
        }
        keys.sort();
        Ok(keys)
    })
    .await
    .map_err(|err| format!("图片列表任务失败: {err}"))?
}

#[tauri::command]
async fn delete_canvas_media(app: tauri::AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MEDIA_STORAGE_LOCK.lock().map_err(|_| "图片存储锁不可用".to_string())?;
        let path = media_storage_path(&app, &key)?;
        for candidate in [
            path.clone(),
            path.with_extension("media.tmp"),
            path.with_extension("media.bak"),
        ] {
            if candidate.exists() {
                fs::remove_file(&candidate)
                    .map_err(|err| format!("删除图片文件失败 ({}): {err}", candidate.display()))?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("图片删除任务失败: {err}"))?
}

#[tauri::command]
async fn fetch_models(url: String, api_key: String) -> Result<serde_json::Value, String> {
    let parsed_url = reqwest::Url::parse(&url).map_err(|err| format!("接口地址无效: {err}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("接口地址仅支持 HTTP 或 HTTPS".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|err| format!("无法创建网络请求: {err}"))?;
    let mut request = client.get(parsed_url).header("Accept", "application/json");
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("请求模型列表失败: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("读取接口响应失败: {err}"))?;
    if !status.is_success() {
        let detail = body.chars().take(500).collect::<String>();
        return Err(format!("HTTP {}: {}", status.as_u16(), detail));
    }

    serde_json::from_str(&body).map_err(|err| format!("接口未返回有效 JSON: {err}"))
}

#[tauri::command]
fn read_dropped_image(path: String) -> Result<DroppedImage, String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).map_err(|err| format!("无法读取图片信息: {err}"))?;
    if !metadata.is_file() {
        return Err("拖入内容不是文件".into());
    }
    if metadata.len() > MAX_DROPPED_IMAGE_BYTES {
        return Err("图片超过 200MB 限制".into());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "无法识别图片格式".to_string())?;
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return Err(format!("不支持的图片格式: {extension}")),
    };

    let bytes = fs::read(&path).map_err(|err| format!("读取图片失败: {err}"))?;
    let file_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("拖入图片")
        .to_string();

    Ok(DroppedImage {
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        file_name,
    })
}

// ============================================================================
// 通用上游 HTTP 通道
//
// 桌面端 WebView 直连第三方厂商会被 CORS 拦截，因此所有生成类请求统一经由
// 本命令转发（与 fetch_models 同一思路）。命令本身不认识任何厂商，只负责
// 忠实转发 method / headers / body，厂商语义全部由前端网关层决定。
// ============================================================================

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultipartField {
    name: String,
    value: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultipartFile {
    /// 表单字段名，如 image / image[]
    name: String,
    /// 上报给上游的文件名
    file_name: String,
    /// MIME，缺省时按 octet-stream 处理
    #[serde(default)]
    mime: Option<String>,
    /// 文件内容的 base64（不含 data: 前缀）
    data_base64: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestArgs {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    /// JSON 请求体（未提供 multipart 字段时生效）
    #[serde(default)]
    json: Option<serde_json::Value>,
    /// multipart 文本字段
    #[serde(default)]
    fields: Vec<MultipartField>,
    /// multipart 文件字段
    #[serde(default)]
    files: Vec<MultipartFile>,
    #[serde(default)]
    request_id: Option<String>,
}

#[derive(Default)]
struct HttpRequestState {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpResponse {
    status: u16,
    ok: bool,
    content_type: String,
    body: String,
}

fn build_headers(input: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for (key, value) in input {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("请求头名称无效 {key}: {err}"))?;
        let parsed =
            HeaderValue::from_str(value).map_err(|err| format!("请求头内容无效 {key}: {err}"))?;
        headers.insert(name, parsed);
    }
    Ok(headers)
}

#[tauri::command]
async fn http_request(
    args: HttpRequestArgs,
    state: State<'_, HttpRequestState>,
) -> Result<HttpResponse, String> {
    let parsed_url =
        reqwest::Url::parse(&args.url).map_err(|err| format!("接口地址无效: {err}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("接口地址仅支持 HTTP 或 HTTPS".into());
    }

    let method_text = args
        .method
        .as_deref()
        .unwrap_or("POST")
        .trim()
        .to_uppercase();
    let method = reqwest::Method::from_bytes(method_text.as_bytes())
        .map_err(|err| format!("请求方法无效 {method_text}: {err}"))?;

    let timeout_ms = args
        .timeout_ms
        .unwrap_or(DEFAULT_HTTP_TIMEOUT_MS)
        .clamp(1_000, MAX_HTTP_TIMEOUT_MS);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|err| format!("无法创建网络请求: {err}"))?;

    let mut headers = build_headers(&args.headers)?;
    if !headers.contains_key(reqwest::header::ACCEPT) {
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("application/json"),
        );
    }
    if !headers.contains_key(reqwest::header::USER_AGENT) {
        headers.insert(
            reqwest::header::USER_AGENT,
            HeaderValue::from_static(DEFAULT_USER_AGENT),
        );
    }

    let has_multipart = !args.fields.is_empty() || !args.files.is_empty();

    let mut request = client.request(method.clone(), parsed_url).headers(headers);

    if has_multipart {
        // 注意：multipart 时不能手动设置 Content-Type，边界由 reqwest 生成。
        let mut form = reqwest::multipart::Form::new();
        for field in &args.fields {
            form = form.text(field.name.clone(), field.value.clone());
        }
        for file in &args.files {
            let bytes = STANDARD
                .decode(file.data_base64.trim())
                .map_err(|err| format!("文件 {} 的 base64 解码失败: {err}", file.file_name))?;
            if bytes.len() > MAX_MULTIPART_FILE_BYTES {
                return Err(format!("文件 {} 超过 64MB 限制", file.file_name));
            }
            let mime = file
                .mime
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string());
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(file.file_name.clone())
                .mime_str(&mime)
                .map_err(|err| format!("文件 {} 的 MIME 无效: {err}", file.file_name))?;
            // 参考图统一按 image 字段名上报时上游可能要求数组写法，
            // 这里保持调用方给定的字段名，不做厂商假设。
            form = form.part(file.name.clone(), part);
        }
        request = request.multipart(form);
    } else if let Some(body) = args.json {
        if method != reqwest::Method::GET && method != reqwest::Method::HEAD {
            request = request.json(&body);
        }
    }

    let request_future = async move {
        let response = request
            .send()
            .await
            .map_err(|err| format!("上游请求失败: {err}"))?;

        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = response
            .text()
            .await
            .map_err(|err| format!("读取上游响应失败: {err}"))?;

        Ok(HttpResponse {
            status: status.as_u16(),
            ok: status.is_success(),
            content_type,
            body,
        })
    };

    let Some(request_id) = args.request_id.filter(|value| !value.is_empty()) else {
        return request_future.await;
    };

    let (cancel_tx, cancel_rx) = oneshot::channel();
    state
        .cancellations
        .lock()
        .map_err(|_| "取消请求状态不可用".to_string())?
        .insert(request_id.clone(), cancel_tx);

    let result = tokio::select! {
        response = request_future => response,
        _ = cancel_rx => Err("请求已取消".to_string()),
    };

    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&request_id);
    }
    result
}

#[tauri::command]
fn cancel_http_request(request_id: String, state: State<'_, HttpRequestState>) -> bool {
    let sender = state
        .cancellations
        .lock()
        .ok()
        .and_then(|mut cancellations| cancellations.remove(&request_id));
    sender
        .map(|cancel| cancel.send(()).is_ok())
        .unwrap_or(false)
}

/// 按扩展名猜 MIME（本地文件没有 Content-Type 可读）。
fn guess_binary_mime(path: &std::path::Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    };
    mime.to_string()
}

/// 百分号解码。asset 协议会给路径做 URL 编码（C:\ → C%3A），
/// 这里手写以免为一个函数引入额外依赖。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 3 <= bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// "/E:/dir/a.png" → "E:/dir/a.png"：URL 形式会给 Windows 盘符路径多加一个前导斜杠
fn strip_windows_leading_slash(path: &str) -> String {
    let bytes = path.as_bytes();
    if bytes.len() > 2 && bytes[0] == b'/' && bytes[2] == b':' {
        return path[1..].to_string();
    }
    path.to_string()
}

/// 是否像本机绝对路径：E:\a.png / E:/a.png / \\server\share\a.png
fn looks_like_local_path(text: &str) -> bool {
    if text.starts_with("\\\\") {
        return true;
    }
    let bytes = text.as_bytes();
    bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// file: 协议 → 本机路径
fn local_path_from_url(text: &str) -> Option<String> {
    let rest = text
        .strip_prefix("file://")
        .or_else(|| text.strip_prefix("file:"))?;
    let decoded = percent_decode(rest);
    let without_host = decoded
        .strip_prefix("localhost")
        .unwrap_or(&decoded)
        .to_string();
    Some(strip_windows_leading_slash(&without_host))
}

/// Tauri asset 协议：asset://localhost/<encoded> 或 http://asset.localhost/<encoded>
fn is_asset_protocol_url(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.starts_with("asset:") || lower.contains("asset.localhost")
}

fn local_path_from_asset_url(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let rest = if let Some(index) = lower.find("asset.localhost") {
        text[index + "asset.localhost".len()..].to_string()
    } else if let Some(stripped) = text.strip_prefix("asset://") {
        stripped.to_string()
    } else {
        String::new()
    };
    let rest = rest.split(['?', '#']).next().unwrap_or("").to_string();
    let decoded = percent_decode(&rest);
    let without_host = decoded
        .strip_prefix("localhost")
        .unwrap_or(&decoded)
        .to_string();
    strip_windows_leading_slash(&without_host)
}

/// 读本机文件并回传 base64。
///
/// 参考图有相当一部分是用户本地上传的图片：项目重新加载后它们会变成
/// `blob:` URL（渲染没问题，但任何后端都取不到字节），或直接就是磁盘路径。
/// 桌面端由本机读取是唯一可行且不引入远程上传服务的做法。
fn read_local_binary(path_text: &str) -> Result<BinaryPayload, String> {
    let path = PathBuf::from(path_text);
    let metadata =
        fs::metadata(&path).map_err(|err| format!("本地文件不可读 ({path_text}): {err}"))?;
    if !metadata.is_file() {
        return Err(format!("不是文件: {path_text}"));
    }
    if metadata.len() > MAX_MULTIPART_FILE_BYTES as u64 {
        return Err("资源超过 64MB 限制".into());
    }

    let bytes = fs::read(&path).map_err(|err| format!("读取本地文件失败 ({path_text}): {err}"))?;
    Ok(BinaryPayload {
        content_type: guess_binary_mime(&path),
        byte_length: bytes.len(),
        data_base64: STANDARD.encode(&bytes),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryPayload {
    content_type: String,
    data_base64: String,
    byte_length: usize,
}

/// 取二进制资源（参考图 / 首帧图 / 待保存的素材）的字节。
///
/// 来源很杂，按来源分流：
///   - http(s) 外链（上游返回的图片地址）→ 走网络，顺带绕开 CORS
///   - file: / asset: / 裸磁盘路径        → 本机读盘
///   - blob:                              → 只能由前端在 webview 内解析，这里明确报错
///
/// `fetch_binary`（把字节交给前端）与 `save_media_file`（直接落盘）共用这一份，
/// 免得"能读到的格式"在两个命令之间出现两套口径。
async fn load_binary(url: &str, timeout_ms: Option<u64>) -> Result<BinaryPayload, String> {
    let raw = url.trim().to_string();
    if raw.is_empty() {
        return Err("资源地址为空".into());
    }

    if raw.to_ascii_lowercase().starts_with("blob:") {
        return Err("blob: 地址只能在应用内解析，不能交给后端读取（应在前端直接取其字节）".into());
    }

    if is_asset_protocol_url(&raw) {
        let path = local_path_from_asset_url(&raw);
        return read_local_binary(&path);
    }

    if let Some(path) = local_path_from_url(&raw) {
        return read_local_binary(&path);
    }

    if looks_like_local_path(&raw) {
        return read_local_binary(&raw);
    }

    let parsed_url =
        reqwest::Url::parse(&raw).map_err(|err| format!("资源地址无效 ({raw}): {err}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err(format!(
            "该来源的图片无法取字节：只支持 http(s) 外链与本地文件，收到的是 `{}:`（{raw}）",
            parsed_url.scheme()
        ));
    }

    let timeout_ms = timeout_ms
        .unwrap_or(60_000)
        .clamp(1_000, MAX_HTTP_TIMEOUT_MS);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|err| format!("无法创建网络请求: {err}"))?;

    let response = client
        .get(parsed_url)
        .header(reqwest::header::USER_AGENT, DEFAULT_USER_AGENT)
        .send()
        .await
        .map_err(|err| format!("资源请求失败: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("资源请求失败 (HTTP {})", status.as_u16()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取资源内容失败: {err}"))?;

    if bytes.len() > MAX_MULTIPART_FILE_BYTES {
        return Err("资源超过 64MB 限制".into());
    }

    Ok(BinaryPayload {
        content_type,
        byte_length: bytes.len(),
        data_base64: STANDARD.encode(&bytes),
    })
}

#[tauri::command]
async fn fetch_binary(url: String, timeout_ms: Option<u64>) -> Result<BinaryPayload, String> {
    load_binary(&url, timeout_ms).await
}

/// 把一份素材存到用户选定的位置（原生「另存为」）| Native save-as
///
/// **必须在 Rust 侧做。** 前端那条路走不通：WebView2 不会理会 `<a download>` +
/// blob 地址，点了既不下载也不报错。这里换成原生保存对话框，路径由用户自己选。
///
/// 字节两个来源二选一（Tauri 的入参会从 camelCase 映射到 snake_case 参数名）：
///   - `url`         ：http(s) 外链 / 本地路径，走 `load_binary`
///   - `data_base64` ：`data:` / `blob:` 地址只有 webview 解析得出来，
///                     前端先解码好再送过来（`load_binary` 读不了这两种）
///
/// 取消返回 `Ok(None)`，前端据此不提示成功、也不当作失败。
#[tauri::command]
async fn save_media_file(
    app: tauri::AppHandle,
    file_name: String,
    url: Option<String>,
    data_base64: Option<String>,
) -> Result<Option<String>, String> {
    let trimmed_url = url.unwrap_or_default().trim().to_string();
    let bytes = if !trimmed_url.is_empty() {
        let payload = load_binary(&trimmed_url, None).await?;
        STANDARD
            .decode(&payload.data_base64)
            .map_err(|err| format!("素材内容解码失败: {err}"))?
    } else if let Some(data) = data_base64.filter(|value| !value.is_empty()) {
        STANDARD
            .decode(&data)
            .map_err(|err| format!("素材内容解码失败: {err}"))?
    } else {
        return Err("没有可保存的素材内容".into());
    };

    // 必须自己持有一份：这个值要移进 spawn_blocking 的闭包（'static），
    // 借用入参 `file_name` 活不了那么长
    let trimmed = file_name.trim();
    let default_name = if trimmed.is_empty() {
        "素材".to_string()
    } else {
        trimmed.to_string()
    };
    let dialog_app = app.clone();

    let picked = tauri::async_runtime::spawn_blocking(move || {
        // blocking_* 只能在非主线程调：它内部 run_on_main_thread 建对话框，
        // 再在当前线程 rx.recv() 阻塞。放主线程会死锁（同 pick_asset_root）。
        dialog_app
            .dialog()
            .file()
            .set_title("保存素材")
            .set_file_name(default_name.as_str())
            .blocking_save_file()
    })
    .await
    .map_err(|err| format!("保存对话框打开失败: {err}"))?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|err| format!("无法解析所选位置: {err}"))?;
    fs::write(&path, &bytes).map_err(|err| format!("写入失败 ({}): {err}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------------------
// 本地素材库 | Local asset library
//
// 画布以「引用式」消费用户的本地素材库：节点只存相对素材库根的相对路径，
// 字节按需读取、永不落进 localStorage / IndexedDB。根目录由用户在原生目录
// 选择器里指定、由 Rust 侧持有 —— 前端传来的只有相对路径，一律经过 resolve
// 边界校验。
// ---------------------------------------------------------------------------

/// 运行期素材库根目录。存**用户选定的原始路径**（不做 canonicalize），
/// 这样界面显示的是 `F:\02-设计素材库` 而不是 Windows 的 `\\?\F:\...`。
/// 需要做包含性判定时，由 [`canonical_asset_root`] 现场 canonicalize。
struct AssetRootState(Mutex<PathBuf>);

// 不能 derive(Default)：PathBuf::default() 是空路径，会让默认根目录变成空串
impl Default for AssetRootState {
    fn default() -> Self {
        Self(Mutex::new(PathBuf::from(DEFAULT_ASSET_ROOT)))
    }
}

impl AssetRootState {
    /// 取一份 PathBuf 快照。必须在 await 之前调用，锁不跨 await。
    fn snapshot(&self) -> Result<PathBuf, String> {
        self.0
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| "素材库根目录状态不可用".to_string())
    }

    fn set(&self, root: PathBuf) -> Result<(), String> {
        let mut guard = self
            .0
            .lock()
            .map_err(|_| "素材库根目录状态不可用".to_string())?;
        *guard = root;
        Ok(())
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AssetRootConfig {
    root: String,
}

fn asset_config_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(ASSET_CONFIG_FILE))
        .map_err(|err| format!("无法定位配置目录: {err}"))
}

/// 读不到 / 解析失败一律回退 None —— 配置文件损坏绝不能让应用起不来。
fn load_persisted_asset_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    let text = fs::read_to_string(asset_config_path(app).ok()?).ok()?;
    let config: AssetRootConfig = serde_json::from_str(&text).ok()?;
    let root = config.root.trim();
    if root.is_empty() {
        None
    } else {
        Some(PathBuf::from(root))
    }
}

fn persist_asset_root<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    root: &Path,
) -> Result<(), String> {
    let path = asset_config_path(app)?;
    if let Some(dir) = path.parent() {
        // app_config_dir() 只给路径、不建目录
        fs::create_dir_all(dir).map_err(|err| format!("创建配置目录失败: {err}"))?;
    }
    let config = AssetRootConfig {
        root: root.to_string_lossy().to_string(),
    };
    let bytes =
        serde_json::to_vec_pretty(&config).map_err(|err| format!("序列化配置失败: {err}"))?;
    fs::write(&path, bytes).map_err(|err| format!("写入配置失败: {err}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetEntry {
    /// 相对素材库根的路径，正斜杠分隔："01-意式极简/11-沙发/xxx.webp"。
    /// 这就是持久化到画布节点 data.assetRef 的值。
    relative_path: String,
    /// 文件名主名（不含扩展名），用作节点 label
    name: String,
    /// 小写扩展名。前端不要自己 split('.')，交给 Rust，避免 "a.b.c.jpg" 误判
    extension: String,
    /// 顶层分类目录名；根目录散图为空串
    category: String,
    /// 直接父目录名（二级分类）；根目录散图为空串
    folder: String,
    byte_length: u64,
    /// 修改时间（Unix 毫秒）—— 缩略图缓存失效的唯一依据
    modified_ms: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetLibrary {
    root: String,
    entries: Vec<AssetEntry>,
    /// 被规则跳过的条目数（隐藏目录、非图片、超深目录）
    skipped: usize,
    truncated: bool,
    scanned_ms: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetFileStatus {
    relative_path: String,
    exists: bool,
    byte_length: u64,
    modified_ms: u64,
}

/// 目录是否该整棵跳过：所有以 `.` 开头的目录（覆盖 .pixcall / .pixcall.cache /
/// .bf / .git），外加显式名单（覆盖 $RECYCLE.BIN 这类不带点的）。
fn is_asset_skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || ASSET_SKIP_DIRS
            .iter()
            .any(|skip| name.eq_ignore_ascii_case(skip))
}

/// 校验并拆分相对路径。返回的每一段都已确认不含越权语法。
///
/// 这是素材库命令唯一的安全边界：现有 fetch_binary 是「给啥读啥」，而这里
/// 收的是前端字符串，必须自己挡住绝对路径、盘符、UNC、`..`，
/// 以及含 `:` 的段（NTFS 数据流语法 `file.txt:stream`）。
fn asset_segments(relative: &str) -> Result<Vec<String>, String> {
    let text = relative.trim().replace('\\', "/");
    if text.is_empty() {
        return Err("素材路径为空".into());
    }
    if looks_like_local_path(&text) || text.starts_with('/') {
        return Err("素材路径必须是相对素材库根的相对路径".into());
    }

    let mut segments = Vec::new();
    for segment in text.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err("素材路径不允许包含 ..".into());
        }
        if segment.contains(':') {
            return Err("素材路径包含非法字符".into());
        }
        segments.push(segment.to_string());
    }
    if segments.is_empty() {
        return Err("素材路径为空".into());
    }
    Ok(segments)
}

/// 素材库根目录（已 canonicalize）。Windows 上会带 `\\?\` 前缀，
/// 所以包含性判定必须用它、而不是配置里的裸字符串。
fn canonical_asset_root(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|err| format!("素材库目录不可用 ({}): {err}", root.display()))
}

/// 相对路径 → 受根目录约束的绝对路径。文件必须已存在（内部要 canonicalize）。
fn resolve_asset_path(relative: &str, root: &Path) -> Result<PathBuf, String> {
    let root = canonical_asset_root(root)?;
    let mut candidate = root.clone();
    for segment in asset_segments(relative)? {
        candidate.push(segment);
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|err| format!("素材不可用 ({relative}): {err}"))?;
    // 复核：符号链接 / junction 可能把路径指到根目录之外
    if !resolved.starts_with(&root) {
        return Err("素材路径越界".into());
    }
    Ok(resolved)
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as u64)
        .unwrap_or(0)
}

/// 单条素材的存在性与元数据。
///
/// 文件不存在时返回 `exists: false` 而不是 Err ——「文件被删了」是素材库的
/// 正常状态，画布要据此渲染「素材已丢失」占位，不该被当成调用失败。
fn asset_status(relative: &str, root: &Path) -> AssetFileStatus {
    let missing = AssetFileStatus {
        relative_path: relative.to_string(),
        exists: false,
        byte_length: 0,
        modified_ms: 0,
    };
    let Ok(root) = canonical_asset_root(root) else {
        return missing;
    };
    let Ok(segments) = asset_segments(relative) else {
        return missing;
    };

    let mut candidate = root.clone();
    for segment in segments {
        candidate.push(segment);
    }
    let Ok(resolved) = candidate.canonicalize() else {
        return missing;
    };
    if !resolved.starts_with(&root) {
        return missing;
    }
    let Ok(metadata) = fs::metadata(&resolved) else {
        return missing;
    };
    if !metadata.is_file() {
        return missing;
    }

    AssetFileStatus {
        relative_path: relative.to_string(),
        exists: true,
        byte_length: metadata.len(),
        modified_ms: modified_ms(&metadata),
    }
}

/// 自然序比较：让 "11-沙发" 排在 "2-xxx" 之后（纯字典序会颠倒）。
/// 前端只对已渲染的子集排序，列表本身有序才能保证分批追加时顺序稳定。
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut left = a.chars().peekable();
    let mut right = b.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(lc), Some(rc)) => {
                if lc.is_ascii_digit() && rc.is_ascii_digit() {
                    let mut lnum = String::new();
                    while let Some(c) = left.peek().copied() {
                        if !c.is_ascii_digit() {
                            break;
                        }
                        lnum.push(c);
                        left.next();
                    }
                    let mut rnum = String::new();
                    while let Some(c) = right.peek().copied() {
                        if !c.is_ascii_digit() {
                            break;
                        }
                        rnum.push(c);
                        right.next();
                    }
                    let lval: u128 = lnum.trim_start_matches('0').parse().unwrap_or(0);
                    let rval: u128 = rnum.trim_start_matches('0').parse().unwrap_or(0);
                    match lval.cmp(&rval) {
                        std::cmp::Ordering::Equal => continue,
                        other => return other,
                    }
                }
                left.next();
                right.next();
                match lc.cmp(&rc) {
                    std::cmp::Ordering::Equal => continue,
                    other => return other,
                }
            }
        }
    }
}

/// 递归扫描素材库。抽成独立函数是为了能用临时目录写单测，不必碰真实的 F:。
fn scan_asset_root(root: &Path) -> Result<AssetLibrary, String> {
    let started = Instant::now();
    let canonical = root
        .canonicalize()
        .map_err(|err| format!("素材库目录不可用 ({}): {err}", root.display()))?;

    let mut entries: Vec<AssetEntry> = Vec::new();
    let mut skipped = 0usize;
    let mut truncated = false;

    // 显式栈代替递归：深度可控，也不会因异常目录树爆栈
    let mut stack: Vec<(PathBuf, usize)> = vec![(canonical.clone(), 1)];
    'outer: while let Some((dir, depth)) = stack.pop() {
        // 单个子目录读不了（权限 / 坏道）不该让整次扫描失败
        let Ok(reader) = fs::read_dir(&dir) else {
            continue;
        };
        for item in reader.flatten() {
            if entries.len() >= ASSET_MAX_ENTRIES {
                truncated = true;
                break 'outer;
            }
            let path = item.path();
            let file_name = item.file_name().to_string_lossy().to_string();
            // file_type() 取自 read_dir 已缓存的目录项，Windows 上不再额外发系统调用
            let Ok(file_type) = item.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                if depth >= ASSET_MAX_DEPTH || is_asset_skip_dir(&file_name) {
                    skipped += 1;
                    continue;
                }
                stack.push((path, depth + 1));
                continue;
            }
            // junction / 符号链接一律不进：既避免目录环，也避免越出根目录
            if !file_type.is_file() {
                skipped += 1;
                continue;
            }
            // 隐藏文件与隐藏目录一视同仁地跳过，避免 .DS_Store 之类混进网格
            if file_name.starts_with('.') {
                skipped += 1;
                continue;
            }

            let Some(extension) = path
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
            else {
                skipped += 1;
                continue;
            };
            if !ASSET_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
                skipped += 1;
                continue;
            }

            let Ok(metadata) = item.metadata() else {
                continue;
            };
            let relative = path
                .strip_prefix(&canonical)
                .map(|rest| rest.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| file_name.clone());

            let parts: Vec<&str> = relative.split('/').collect();
            entries.push(AssetEntry {
                name: path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&file_name)
                    .to_string(),
                // 单个段 = 根目录散图，没有分类也没有父目录
                category: if parts.len() > 1 {
                    parts[0].to_string()
                } else {
                    String::new()
                },
                folder: if parts.len() > 1 {
                    parts[parts.len() - 2].to_string()
                } else {
                    String::new()
                },
                relative_path: relative,
                extension,
                byte_length: metadata.len(),
                modified_ms: modified_ms(&metadata),
            });
        }
    }

    entries.sort_by(|a, b| natural_cmp(&a.relative_path, &b.relative_path));

    Ok(AssetLibrary {
        // 汇报配置的原始路径而非 canonical：前端只用它展示，
        // canonical 的 `\\?\` 前缀是可见的 UX 退化。relative_path 仍由
        // strip_prefix(&canonical) 产出，不受影响。
        root: root.to_string_lossy().to_string(),
        entries,
        skipped,
        truncated,
        scanned_ms: started.elapsed().as_millis() as u64,
    })
}

/// 扫描素材库并返回全部图片的元数据（不含字节）。
///
/// async 是硬要求：同步命令跑在主线程，556 次 stat 会让 WebView 直接卡住；
/// async 命令由 Tauri 丢进阻塞线程池，不阻塞 UI。
#[tauri::command]
async fn list_asset_library(state: State<'_, AssetRootState>) -> Result<AssetLibrary, String> {
    let root = state.snapshot()?;
    tauri::async_runtime::spawn_blocking(move || scan_asset_root(&root))
        .await
        .map_err(|err| format!("素材库扫描失败: {err}"))?
}

/// 读取单个素材文件。字节只在这次调用里过一遍，不落任何持久层。
#[tauri::command]
async fn read_asset_file(
    relative_path: String,
    state: State<'_, AssetRootState>,
) -> Result<BinaryPayload, String> {
    let root = state.snapshot()?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_asset_path(&relative_path, &root)?;
        let metadata =
            fs::metadata(&path).map_err(|err| format!("素材不可用 ({relative_path}): {err}"))?;
        if metadata.len() > MAX_ASSET_FILE_BYTES {
            return Err("素材超过 64MB 限制".into());
        }
        let bytes =
            fs::read(&path).map_err(|err| format!("读取素材失败 ({relative_path}): {err}"))?;
        Ok(BinaryPayload {
            content_type: guess_binary_mime(&path),
            byte_length: bytes.len(),
            data_base64: STANDARD.encode(&bytes),
        })
    })
    .await
    .map_err(|err| format!("读取素材失败: {err}"))?
}

/// 批量检查素材是否还在。画布加载时一次判定几十个引用，
/// 避免 N 次 IPC 往返。盘符没挂载时整体失败，由前端区分「未连接」与「已丢失」。
#[tauri::command]
async fn stat_asset_files(
    relative_paths: Vec<String>,
    state: State<'_, AssetRootState>,
) -> Result<Vec<AssetFileStatus>, String> {
    let root = state.snapshot()?;
    tauri::async_runtime::spawn_blocking(move || {
        relative_paths
            .iter()
            .map(|path| asset_status(path, &root))
            .collect()
    })
    .await
    .map_err(|err| format!("素材状态检查失败: {err}"))
}

/// 返回**配置的原始路径**（未 canonicalize）。
///
/// 存在的唯一理由：目录缺失时 `list_asset_library` 会 Err，前端拿不到
/// 「是哪个路径失败了」，错误态需要它把失败路径显示出来。
#[tauri::command]
fn get_asset_root(state: State<'_, AssetRootState>) -> Result<String, String> {
    state
        .snapshot()
        .map(|root| root.to_string_lossy().to_string())
}

/// 打开原生文件夹选择器，用户选定后持久化并切换根目录。
///
/// 路径自始至终没有经过前端：前端只拿到「最终生效的路径字符串」用于展示。
/// 取消时返回 `Ok(None)`，前端据此不做任何副作用。
#[tauri::command]
async fn pick_agent_work_dir(app:tauri::AppHandle)->Result<Option<String>,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let picked=app.dialog().file().set_title("选择智能体工作目录").blocking_pick_folder();
        picked.map(|p|p.into_path().map(|p|p.to_string_lossy().into_owned()).map_err(|e|e.to_string())).transpose()
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn pick_agent_cli_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择智能体程序")
            .add_filter("程序文件", &["exe", "cmd", "bat"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| format!("程序选择失败: {err}"))?;
    let Some(path) = picked else { return Ok(None); };
    let path = path.into_path().map_err(|err| format!("无法解析程序路径: {err}"))?;
    if !path.is_file() { return Err("所选程序不存在".into()); }
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn pick_asset_root(
    app: tauri::AppHandle,
    state: State<'_, AssetRootState>,
) -> Result<Option<String>, String> {
    let start_dir = state.snapshot()?;
    let dialog_app = app.clone();

    let picked = tauri::async_runtime::spawn_blocking(move || {
        // blocking_* 只能在非主线程调：它内部 run_on_main_thread 建对话框，
        // 再在当前线程 rx.recv() 阻塞。放主线程会死锁。
        let builder = dialog_app.dialog().file().set_title("选择素材库根目录");
        let builder = if start_dir.is_dir() {
            builder.set_directory(&start_dir)
        } else {
            builder
        };
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|err| format!("目录选择失败: {err}"))?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let raw = file_path
        .into_path()
        .map_err(|err| format!("无法解析所选目录: {err}"))?;
    if !raw.is_dir() {
        return Err("所选路径不是文件夹".into());
    }
    // 立刻验证可 canonicalize：不存在 / 无权限时给出明确错误，
    // 而不是拖到扫描阶段才暴露
    raw.canonicalize()
        .map_err(|err| format!("所选目录不可用 ({}): {err}", raw.display()))?;

    // 顺序要紧：先落盘、成功后再改内存 state，
    // 否则写盘失败会导致「内存新、磁盘旧」，重启后行为跳变
    persist_asset_root(&app, &raw)?;
    state.set(raw.clone())?;
    Ok(Some(raw.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ids_cannot_escape_the_storage_directory() {
        for valid in ["project_123_abc", "canvas-42", "A1_b-2"] {
            assert!(validate_project_id(valid).is_ok(), "应接受项目 ID: {valid}");
        }
        for invalid in ["", "../secret", "a/b", "a\\b", "C:drive", "项目"] {
            assert!(
                validate_project_id(invalid).is_err(),
                "应拒绝项目 ID: {invalid}"
            );
        }
    }

    #[test]
    fn project_temp_recovery_replaces_an_existing_windows_file() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ling-canvas-project-recovery-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("project_test.json");
        let temp = dir.join("project_test.json.tmp");
        fs::write(&target, br#"{"id":"project_test","name":"old"}"#).unwrap();
        fs::write(&temp, br#"{"id":"project_test","name":"new"}"#).unwrap();

        recover_project_document_sidecars(&dir).unwrap();

        let restored: serde_json::Value =
            serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        assert_eq!(restored["name"], "new");
        assert!(!temp.exists());
        let _ = fs::remove_dir_all(dir);
    }

    /// 前端 services/aiGateway.js 发出的字段名必须与结构体严格对齐。
    /// 这里锁死 camelCase 映射，避免以后改字段名时静默丢参。
    #[test]
    fn deserializes_json_payload_from_frontend() {
        let raw = r#"{
            "url": "https://api.example.com/v1/images/generations",
            "method": "POST",
            "headers": { "Authorization": "Bearer k" },
            "timeoutMs": 300000,
            "json": { "model": "m", "prompt": "p", "n": 2 },
            "fields": [],
            "files": []
        }"#;
        let args: HttpRequestArgs = serde_json::from_str(raw).expect("应能反序列化前端 JSON 请求");

        assert_eq!(args.url, "https://api.example.com/v1/images/generations");
        assert_eq!(args.method.as_deref(), Some("POST"));
        assert_eq!(args.timeout_ms, Some(300_000));
        assert_eq!(
            args.headers.get("Authorization").map(String::as_str),
            Some("Bearer k")
        );
        assert_eq!(args.json.unwrap()["n"], 2);
        assert!(args.fields.is_empty());
        assert!(args.files.is_empty());
    }

    /// 图生图 multipart 载荷：字段名 / 文件名 / MIME / base64 都要能解出，
    /// 并且不得携带 json 体（否则上游会按 JSON 解析而丢文件）。
    #[test]
    fn deserializes_multipart_payload_from_frontend() {
        let raw = r#"{
            "url": "https://api.example.com/v1/images/edits",
            "method": "POST",
            "fields": [
                { "name": "model", "value": "m" },
                { "name": "n", "value": "1" }
            ],
            "files": [
                { "name": "image", "fileName": "ling-canvas-reference-1.png",
                  "mime": "image/png", "dataBase64": "aGVsbG8=" }
            ]
        }"#;
        let args: HttpRequestArgs = serde_json::from_str(raw).expect("应能反序列化 multipart 载荷");

        assert_eq!(args.fields.len(), 2);
        assert_eq!(args.fields[0].name, "model");
        assert_eq!(args.files.len(), 1);

        let file = &args.files[0];
        assert_eq!(file.name, "image");
        assert_eq!(file.file_name, "ling-canvas-reference-1.png");
        assert_eq!(file.mime.as_deref(), Some("image/png"));
        assert_eq!(
            STANDARD.decode(file.data_base64.trim()).unwrap(),
            b"hello".to_vec()
        );
        assert!(args.json.is_none(), "multipart 请求不应携带 json 体");
    }

    /// 缺省字段必须可省略：GET 查询（video-query）不带 json / headers / timeout。
    #[test]
    fn deserializes_minimal_get_payload() {
        let args: HttpRequestArgs =
            serde_json::from_str(r#"{"url":"https://x/v1/video/task/abc","method":"GET"}"#)
                .unwrap();
        assert!(args.json.is_none());
        assert!(args.headers.is_empty());
        assert!(args.timeout_ms.is_none());
        assert!(args.files.is_empty());
    }

    #[test]
    fn build_headers_rejects_invalid_names() {
        let mut headers = HashMap::new();
        headers.insert("Bad Header".to_string(), "v".to_string());
        assert!(build_headers(&headers).is_err());

        let mut ok = HashMap::new();
        ok.insert("Authorization".to_string(), "Bearer k".to_string());
        assert_eq!(build_headers(&ok).unwrap().len(), 1);
    }

    /// 素材路径的越权语法必须全部挡住——这是素材库命令唯一的安全边界。
    /// 这些用例只走语法校验，不需要真实的 F: 盘。
    #[test]
    fn rejects_escaping_asset_paths() {
        for bad in [
            "../secrets.png",
            "01-意式极简/../../secrets.png",
            "..\\secrets.png",
            "/etc/passwd",
            "C:/Windows/system.ini",
            "\\\\server\\share\\a.png",
            // NTFS 数据流语法：file.txt:stream
            "01-意式极简/a:b.png",
            "",
            "   ",
        ] {
            assert!(asset_segments(bad).is_err(), "应拒绝越权路径: {bad:?}");
        }
    }

    #[test]
    fn accepts_plain_asset_paths() {
        assert_eq!(
            asset_segments("01-意式极简/11-沙发/a.webp").unwrap(),
            vec!["01-意式极简", "11-沙发", "a.webp"]
        );
        // 前导 "./" 与重复斜杠应被规范化掉，而不是当成越权
        assert_eq!(
            asset_segments("./01-意式极简//a b.png").unwrap(),
            vec!["01-意式极简", "a b.png"]
        );
        // 反斜杠也当分隔符接受（Windows 路径习惯）
        assert_eq!(
            asset_segments("01-意式极简\\a.png").unwrap(),
            vec!["01-意式极简", "a.png"]
        );
    }

    /// 自然序：不这么做的话 "11-沙发" 会排到 "2-xxx" 前面
    #[test]
    fn natural_order_puts_11_after_2() {
        assert_eq!(natural_cmp("2-xxx", "11-沙发"), std::cmp::Ordering::Less);
        assert_eq!(natural_cmp("11-沙发", "2-xxx"), std::cmp::Ordering::Greater);
        assert_eq!(natural_cmp("01-a", "01-b"), std::cmp::Ordering::Less);
        assert_eq!(natural_cmp("01-a", "01-a"), std::cmp::Ordering::Equal);
    }

    /// 跳过规则：隐藏目录里的预览图绝不能进列表。
    /// 用临时目录造一棵小树，不碰真实素材库。
    #[test]
    fn scan_skips_hidden_dirs_and_non_images() {
        let root = std::env::temp_dir().join(format!("ling-asset-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);

        let visible = root.join("01-意式极简").join("11-沙发");
        let pixcall_trash = root.join(".pixcall").join("trash");
        let billfish_preview = root.join(".bf").join(".preview");
        for dir in [&visible, &pixcall_trash, &billfish_preview] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(visible.join("a.webp"), b"x").unwrap();
        fs::write(root.join("b.jpg"), b"x").unwrap();
        fs::write(pixcall_trash.join("deleted.png"), b"x").unwrap();
        fs::write(billfish_preview.join("preview.png"), b"x").unwrap();
        fs::write(visible.join("notes.txt"), b"x").unwrap();

        let library = scan_asset_root(&root).unwrap();
        let paths: Vec<&str> = library
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect();

        assert_eq!(
            paths,
            vec!["01-意式极简/11-沙发/a.webp", "b.jpg"],
            "隐藏目录里的预览图与非图片都不该出现"
        );

        let nested = &library.entries[0];
        assert_eq!(nested.category, "01-意式极简");
        assert_eq!(nested.folder, "11-沙发");
        assert_eq!(nested.extension, "webp");
        assert_eq!(nested.name, "a");

        let root_file = &library.entries[1];
        assert_eq!(root_file.category, "", "根目录散图不应有分类");
        assert_eq!(root_file.folder, "", "根目录散图不应有父目录");
        assert!(!library.truncated);

        let _ = fs::remove_dir_all(&root);
    }
}

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必须先注册：第二次启动只唤起已有窗口，不创建新的数据写入实例。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_main_window(app);
        }))
        .manage(HttpRequestState::default())
        .manage(AssetRootState::default())
        .manage(agent::AgentProcessState::default())
        .manage(codex_agent::CodexBridgeState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = app.default_window_icon().cloned().ok_or("缺少系统托盘图标")?;
            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Ling Canvas")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }) {
                        restore_main_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => restore_main_window(app),
                    "quit" => {
                        // Use the existing close handler to flush saves before shutdown.
                        restore_main_window(app);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.close();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(root) = load_persisted_asset_root(app.handle()) {
                if let Err(err) = app.state::<AssetRootState>().set(root) {
                    eprintln!("读取素材库根目录失败: {err}");
                }
            }
            Ok(())
        })
        // 窗口一销毁就把所有还在跑的 claude 进程树收掉，别留下烧 token 的 node.exe
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<agent::AgentProcessState>().kill_all();
                window.state::<codex_agent::CodexBridgeState>().shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_project_documents,
            write_project_document,
            delete_project_documents,
            get_media_storage_root,
            pick_media_storage_root,
            save_canvas_media,
            load_canvas_media,
            list_canvas_media_keys,
            delete_canvas_media,
            read_dropped_image,
            fetch_models,
            http_request,
            cancel_http_request,
            fetch_binary,
            save_media_file,
            local_space::local_folders,
            local_space::connect_local_folder,
            local_space::update_local_folder,
            local_space::list_local_folder,
            local_space::read_local_image,
            local_space::read_local_folder_cover,
            local_space::read_local_text,
            local_space::open_local_folder,
            local_space::save_local_image,
            list_asset_library,
            read_asset_file,
            stat_asset_files,
            get_asset_root,
            pick_asset_root,
            pick_agent_cli_path,
            pick_agent_work_dir,
            agent::detect_agent_cli_path,
            agent::list_agent_skills,
            codex_agent::probe_local_agent,
            codex_agent::codex_capabilities,
            codex_agent::codex_send,
            codex_agent::codex_respond,
            agent::agent_send,
            agent::agent_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
