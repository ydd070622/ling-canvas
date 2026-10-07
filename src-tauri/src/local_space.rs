use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
#[derive(Clone, Serialize, Deserialize)]
pub struct Folder {
    id: String,
    name: String,
    path: String,
}
static LOCK: Mutex<()> = Mutex::new(());
fn config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("local-folders.json"))
}
fn read(app: &tauri::AppHandle) -> Result<Vec<Folder>, String> {
    let p = config(app)?;
    if !p.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn write(app: &tauri::AppHandle, folders: &[Folder]) -> Result<(), String> {
    let p = config(app)?;
    let tmp = p.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_vec(folders).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, p).map_err(|e| e.to_string())
}
fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if Path::new(relative)
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("路径必须在连接的文件夹内".into());
    }
    let p = root
        .join(relative)
        .canonicalize()
        .map_err(|e| format!("文件夹或文件不可用: {e}"))?;
    if !p.starts_with(root) {
        return Err("不能访问连接目录之外的文件".into());
    }
    Ok(p)
}
fn root(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let f = read(app)?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or("文件夹已取消连接")?;
    PathBuf::from(f.path)
        .canonicalize()
        .map_err(|e| format!("本地文件夹不可用: {e}"))
}
#[tauri::command]
pub fn local_folders(app: tauri::AppHandle) -> Result<Vec<Folder>, String> {
    read(&app)
}
#[tauri::command]
pub async fn connect_local_folder(app: tauri::AppHandle) -> Result<Option<Folder>, String> {
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("连接本地文件夹")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let p = picked.into_path().map_err(|e| e.to_string())?;
    let canonical = p.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_dir() {
        return Err("请选择文件夹".into());
    }
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let mut folders = read(&app)?;
    if let Some(f) = folders
        .iter()
        .find(|f| PathBuf::from(&f.path).canonicalize().ok().as_ref() == Some(&canonical))
    {
        return Ok(Some(f.clone()));
    }
    let f = Folder {
        id: format!(
            "local-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ),
        name: p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: p.to_string_lossy().into_owned(),
    };
    folders.push(f.clone());
    write(&app, &folders)?;
    Ok(Some(f))
}
#[tauri::command]
pub fn update_local_folder(
    app: tauri::AppHandle,
    id: String,
    name: Option<String>,
) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let mut folders = read(&app)?;
    if let Some(name) = name {
        if name.trim().is_empty() {
            return Err("名称不能为空".into());
        }
        let f = folders
            .iter_mut()
            .find(|f| f.id == id)
            .ok_or("文件夹不存在")?;
        f.name = name.trim().into()
    } else {
        folders.retain(|f| f.id != id)
    }
    write(&app, &folders)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    relative_path: String,
    is_dir: bool,
    byte_length: u64,
    kind: String,
    modified_at: u64,
}
#[tauri::command]
pub fn list_local_folder(
    app: tauri::AppHandle,
    id: String,
    relative: String,
) -> Result<Vec<Entry>, String> {
    let r = root(&app, &id)?;
    let p = inside(&r, &relative)?;
    let mut entries = vec![];
    for entry in fs::read_dir(p).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let Ok(c) = path.canonicalize() else { continue };
        if !c.starts_with(&r) {
            continue;
        }
        let m = entry.metadata().map_err(|e| e.to_string())?;
        let mime = super::guess_binary_mime(&path);
        let text = is_text(&path);
        if !m.is_dir() && !mime.starts_with("image/") && !text {
            continue;
        }
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            relative_path: path
                .strip_prefix(&r)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/"),
            is_dir: m.is_dir(),
            byte_length: m.len(),
            modified_at: m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
            kind: if m.is_dir() { "folder" } else if text { "text" } else { "image" }.into(),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}
fn is_text(path: &Path) -> bool { matches!(path.extension().and_then(|e|e.to_str()).unwrap_or("").to_lowercase().as_str(), "txt" | "md" | "markdown" | "log" | "csv" | "json" | "yaml" | "yml") }
fn cover_image(dir: &Path, root: &Path, depth: usize) -> Option<PathBuf> {
    let mut entries:Vec<_> = fs::read_dir(dir).ok()?.filter_map(Result::ok).map(|e|e.path()).collect(); entries.sort();
    for p in &entries { if p.is_file() && super::guess_binary_mime(p).starts_with("image/") && p.canonicalize().map(|p|p.starts_with(root)).unwrap_or(false) { return Some(p.clone()); } }
    if depth > 0 { for p in entries { if p.is_dir() && p.canonicalize().map(|p|p.starts_with(root)).unwrap_or(false) { if let Some(image)=cover_image(&p,root,depth-1){return Some(image)} } } }
    None
}
#[tauri::command]
pub fn read_local_folder_cover(app:tauri::AppHandle,id:String,relative:String)->Result<Option<String>,String>{let r=root(&app,&id)?;let p=inside(&r,&relative)?;let Some(image)=cover_image(&p,&r,2) else{return Ok(None)};let rel=image.strip_prefix(&r).map_err(|e|e.to_string())?.to_string_lossy().into_owned();read_local_image(app,id,rel).map(Some)}
#[tauri::command]
pub fn read_local_text(app:tauri::AppHandle,id:String,relative:String)->Result<String,String>{let p=inside(&root(&app,&id)?,&relative)?;if !is_text(&p){return Err("不支持此文本格式".into())}if fs::metadata(&p).map_err(|e|e.to_string())?.len()>5*1024*1024{return Err("文本超过5MB，请在资源管理器中打开".into())}let bytes=fs::read(p).map_err(|e|e.to_string())?;if bytes.starts_with(&[0xff,0xfe])||bytes.starts_with(&[0xfe,0xff]){let little=bytes[0]==0xff;let units:Vec<u16>=bytes[2..].chunks_exact(2).map(|b|if little{u16::from_le_bytes([b[0],b[1]])}else{u16::from_be_bytes([b[0],b[1]])}).collect();return String::from_utf16(&units).map_err(|_|"文本编码不可识别".into())}String::from_utf8(bytes).map(|s|s.trim_start_matches('\u{feff}').into()).map_err(|_|"文本不是UTF-8，请转换编码后再查看".into())}
#[tauri::command]
pub fn read_local_image(
    app: tauri::AppHandle,
    id: String,
    relative: String,
) -> Result<String, String> {
    let p = inside(&root(&app, &id)?, &relative)?;
    let mime = super::guess_binary_mime(&p);
    if !mime.starts_with("image/") {
        return Err("仅支持图片".into());
    }
    if fs::metadata(&p).map_err(|e|e.to_string())?.len() > super::MAX_DROPPED_IMAGE_BYTES { return Err("图片过大，无法读取".into()); }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
#[tauri::command]
pub fn open_local_folder(
    app: tauri::AppHandle,
    id: String,
    relative: String,
) -> Result<(), String> {
    let p = inside(&root(&app, &id)?, &relative)?;
    std::process::Command::new("explorer.exe")
        .arg(p)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn save_local_image(
    app: tauri::AppHandle,
    id: String,
    relative: String,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    let r = root(&app, &id)?;
    let dir = inside(&r, &relative)?;
    if !dir.is_dir() {
        return Err("保存位置不是文件夹".into());
    }
    let bytes = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    write_image(&dir, &file_name, &bytes)
}
fn write_image(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    if file_name.is_empty()
        || file_name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || file_name.ends_with('.')
        || file_name.ends_with(' ')
    {
        return Err("文件名无效".into());
    }
    let ext = Path::new(&file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"].contains(&ext.as_str()) {
        return Err("仅支持保存图片".into());
    }
    if bytes.is_empty() {
        return Err("图片内容为空".into());
    }
    let stem = Path::new(&file_name).file_stem().unwrap().to_string_lossy();
    let reserved = stem.split('.').next().unwrap_or("").to_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&reserved.as_str()) || (reserved.len() == 4 && (reserved.starts_with("COM") || reserved.starts_with("LPT")) && reserved.ends_with(['1','2','3','4','5','6','7','8','9'])) { return Err("文件名无效".into()); }
    for i in 0..10000 {
        let name = if i == 0 {
            file_name.to_string()
        } else {
            format!("{stem}-{i}.{ext}")
        };
        let p = dir.join(name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(mut f) => {
                if let Err(e) = f.write_all(bytes).and_then(|_| f.sync_all()) {
                    drop(f);
                    let _ = fs::remove_file(&p);
                    return Err(e.to_string());
                }
                return Ok(p.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("保存失败: {e}")),
        }
    }
    Err("无法分配不重复的文件名".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_cover_prefers_first_direct_image_then_nested_image() {
        let dir = std::env::temp_dir().join(format!("ling-cover-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&dir).unwrap();
        let root = dir.canonicalize().unwrap();
        let nested = root.join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("cover.jpg"), b"nested").unwrap();
        fs::write(root.join("02.png"), b"second").unwrap();
        fs::write(root.join("01.jpg"), b"first").unwrap();
        assert_eq!(cover_image(&root, &root, 2), Some(root.join("01.jpg")));
        fs::remove_file(root.join("01.jpg")).unwrap();
        fs::remove_file(root.join("02.png")).unwrap();
        assert_eq!(cover_image(&root, &root, 2), Some(nested.join("cover.jpg")));
        assert!(is_text(Path::new("notes.MD")));
        assert!(is_text(Path::new("notes.markdown")));
        assert!(is_text(Path::new("notes.txt")));
        assert!(!is_text(Path::new("app.exe")));
        fs::remove_file(nested.join("cover.jpg")).unwrap();
        fs::remove_dir(nested).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn relative_paths_cannot_escape() {
        let r = std::env::temp_dir().canonicalize().unwrap();
        for p in ["../a", "C:\\a", "/a", "a/../b"] {
            assert!(inside(&r, p).is_err())
        }
        assert!(inside(&r, "").is_ok());
    }
    #[test]
    fn image_saves_keep_original_bytes_and_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("ling-local-save-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&dir).unwrap();
        let first = write_image(&dir, "客厅.png", b"original-image").unwrap();
        let second = write_image(&dir, "客厅.png", b"second-image").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"original-image");
        assert_eq!(fs::read(&second).unwrap(), b"second-image");
        for invalid in ["../image.png", "a/b.png", "CON.png", "image.exe"] { assert!(write_image(&dir, invalid, b"image").is_err()); }
        fs::remove_file(first).unwrap(); fs::remove_file(second).unwrap(); fs::remove_dir(dir).unwrap();
    }
}
