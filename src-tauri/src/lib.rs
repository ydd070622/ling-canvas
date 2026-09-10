use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::PathBuf};
use std::time::Duration;

const MAX_DROPPED_IMAGE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedImage {
    data_url: String,
    file_name: String,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![read_dropped_image, fetch_models])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
