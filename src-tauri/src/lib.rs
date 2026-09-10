use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::sync::Mutex;
use std::time::Duration;
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::State;
use tokio::sync::oneshot;

const MAX_DROPPED_IMAGE_BYTES: u64 = 200 * 1024 * 1024;
/// 单个 multipart 文件上限（参考图/首帧图解码后）
const MAX_MULTIPART_FILE_BYTES: usize = 64 * 1024 * 1024;
/// 上游生成类请求默认超时：文生图/图生视频首包可能等待数分钟
const DEFAULT_HTTP_TIMEOUT_MS: u64 = 300_000;
const MAX_HTTP_TIMEOUT_MS: u64 = 1_800_000;
const DEFAULT_USER_AGENT: &str = "LingCanvas/1.0 (+tauri)";

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

/// 拉取二进制资源（参考图/首帧图）并回传 base64。
///
/// 来源很杂，按来源分流：
///   - http(s) 外链（上游返回的图片地址）→ 走网络，顺带绕开 CORS
///   - file: / asset: / 裸磁盘路径        → 本机读盘
///   - blob:                              → 只能由前端在 webview 内解析，这里明确报错
#[tauri::command]
async fn fetch_binary(url: String, timeout_ms: Option<u64>) -> Result<BinaryPayload, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HttpRequestState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_dropped_image,
            fetch_models,
            http_request,
            cancel_http_request,
            fetch_binary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
