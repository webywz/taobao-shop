use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const BACKEND_URL: &str = "http://127.0.0.1:4318";

struct AppState {
  backend_child: Mutex<Option<Child>>,
}

#[derive(Debug, Deserialize)]
struct DownloadAssetsInput {
  task_id: String,
  source_url: Option<String>,
  title: Option<String>,
  target: Option<String>,
  main_images: Vec<String>,
  color_images: Vec<String>,
  detail_images: Vec<String>,
  video_url: Option<String>,
  include_main: Option<bool>,
  include_color: Option<bool>,
  include_detail: Option<bool>,
  include_video: Option<bool>,
  dedupe_color: Option<bool>,
  write_record: Option<bool>,
}

#[derive(Debug, Serialize)]
struct DownloadAssetsOutput {
  saved_dir: String,
  main_count: usize,
  color_count: usize,
  detail_count: usize,
  video_count: usize,
  record_path: Option<String>,
}

fn backend_dir() -> Result<PathBuf, String> {
  let src_tauri_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let project_root = src_tauri_dir
    .parent()
    .and_then(|p| p.parent())
    .ok_or("failed to resolve project root")?;
  let dir = project_root.join("backend");
  if !dir.exists() {
    return Err(format!("backend directory not found: {}", dir.display()));
  }
  Ok(dir)
}

fn spawn_backend() -> Result<Child, String> {
  let dir = backend_dir()?;
  Command::new("uv")
    .args(["run", "uvicorn", "main:app", "--port", "4318"])
    .current_dir(dir)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| format!("failed to spawn backend: {}", e))
}

async fn wait_ready() -> Result<(), String> {
  let client = reqwest::Client::new();
  let deadline = std::time::Instant::now() + Duration::from_secs(12);
  let mut last_err = String::new();
  while std::time::Instant::now() < deadline {
    match client.get(format!("{}/health", BACKEND_URL)).send().await {
      Ok(r) if r.status().is_success() => return Ok(()),
      Ok(r) => last_err = r.status().to_string(),
      Err(e) => last_err = e.to_string(),
    }
    std::thread::sleep(Duration::from_millis(250));
  }
  Err(format!("backend not ready: {}", last_err))
}

#[tauri::command]
async fn ensure_backend(state: tauri::State<'_, AppState>) -> Result<bool, String> {
  {
    let mut holder = state.backend_child.lock().map_err(|e| e.to_string())?;
    let running = holder
      .as_mut()
      .map(|c| c.try_wait().ok().flatten().is_none())
      .unwrap_or(false);
    if !running {
      *holder = Some(spawn_backend()?);
    }
  }
  wait_ready().await?;
  Ok(true)
}

#[tauri::command]
async fn backend_request(method: String, path: String, body: Option<Value>) -> Result<Value, String> {
  let m = method.to_uppercase();
  let method = match m.as_str() {
    "GET" => Method::GET,
    "POST" => Method::POST,
    "DELETE" => Method::DELETE,
    "PUT" => Method::PUT,
    _ => return Err(format!("unsupported method: {}", m)),
  };
  let url = format!("{}{}", BACKEND_URL, path);
  let client = reqwest::Client::new();
  let mut req = client.request(method, url);
  if let Some(b) = body {
    req = req.json(&b);
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let ok = resp.status().is_success();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  let json: Value = serde_json::from_str(&text)
    .unwrap_or_else(|_| serde_json::json!({ "message": text }));
  if ok {
    Ok(json)
  } else {
    Err(json.get("detail").and_then(Value::as_str).unwrap_or(&text).to_string())
  }
}

fn sanitize_path_component(input: &str) -> String {
  let sanitized = input
    .chars()
    .map(|ch| match ch {
      '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
      ch if ch.is_control() => '_',
      ch => ch,
    })
    .collect::<String>();

  let trimmed = sanitized.trim().trim_matches('.').trim();
  if trimmed.is_empty() {
    "task".to_string()
  } else {
    trimmed.chars().take(80).collect()
  }
}

fn infer_extension(url: &str, content_type: Option<&str>, default_ext: &str) -> String {
  let from_content_type = content_type
    .and_then(|value| value.split(';').next())
    .map(|value| value.trim().to_ascii_lowercase())
    .and_then(|value| match value.as_str() {
      "image/jpeg" => Some("jpg".to_string()),
      "image/png" => Some("png".to_string()),
      "image/webp" => Some("webp".to_string()),
      "image/gif" => Some("gif".to_string()),
      "video/mp4" => Some("mp4".to_string()),
      "application/vnd.apple.mpegurl" => Some("m3u8".to_string()),
      "application/x-mpegurl" => Some("m3u8".to_string()),
      _ => None,
    });

  if let Some(ext) = from_content_type {
    return ext;
  }

  if let Ok(parsed) = reqwest::Url::parse(url) {
    if let Some(segment) = parsed.path_segments().and_then(|segments| segments.last()) {
      let clean_segment = segment.split('?').next().unwrap_or(segment);
      if let Some((_, ext)) = clean_segment.rsplit_once('.') {
        let normalized = ext.to_ascii_lowercase();
        if normalized.len() <= 5 && normalized.chars().all(|ch| ch.is_ascii_alphanumeric()) {
          return normalized;
        }
      }
    }
  }

  default_ext.to_string()
}

fn normalize_asset_key(url: &str) -> String {
  match reqwest::Url::parse(url) {
    Ok(mut parsed) => {
      parsed.set_query(None);
      parsed.set_fragment(None);
      format!("{}{}", parsed.origin().ascii_serialization(), parsed.path()).to_ascii_lowercase()
    }
    Err(_) => url.trim().to_ascii_lowercase(),
  }
}

fn is_supported_magic(bytes: &[u8], expected_video: bool) -> bool {
  if bytes.is_empty() {
    return false;
  }

  if expected_video {
    return bytes.len() >= 12 && bytes[4..8] == *b"ftyp";
  }

  bytes.starts_with(&[0xFF, 0xD8, 0xFF])
    || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    || bytes.starts_with(b"RIFF")
    || bytes.starts_with(b"GIF87a")
    || bytes.starts_with(b"GIF89a")
    || bytes.starts_with(b"BM")
}

fn resolve_download_dir(task_id: &str, title: Option<&str>) -> Result<PathBuf, String> {
  let base_dir = dirs::download_dir()
    .or_else(|| std::env::current_dir().ok())
    .ok_or("failed to resolve download directory")?;
  let task_name = sanitize_path_component(title.unwrap_or("tb_item"));
  let task_suffix = task_id.chars().take(8).collect::<String>();
  let dir = base_dir
    .join("tbTaui")
    .join(format!("{}_{}", task_name, task_suffix));
  fs::create_dir_all(&dir).map_err(|e| format!("failed to create download directory: {}", e))?;
  Ok(dir)
}

async fn download_group(
  client: &reqwest::Client,
  urls: &[String],
  root_dir: &Path,
  _folder_name: &str,
  file_prefix: &str,
  default_ext: &str,
) -> Result<usize, String> {
  if urls.is_empty() {
    return Ok(0);
  }

  let mut saved_count = 0;
  let mut seen = HashSet::new();

  for url in urls {
    if url.trim().is_empty() || !seen.insert(url.clone()) {
      continue;
    }

    let probe = client
      .get(url)
      .send()
      .await
      .map_err(|e| format!("request failed for {}: {}", url, e))?;

    if !probe.status().is_success() {
      continue;
    }

    let content_type = probe
      .headers()
      .get("content-type")
      .and_then(|v| v.to_str().ok())
      .unwrap_or("");
    let expect_video = default_ext.eq_ignore_ascii_case("mp4");
    let is_expected_type = if expect_video {
      content_type.starts_with("video/") || content_type == "application/octet-stream"
    } else {
      content_type.starts_with("image/") || content_type == "application/octet-stream"
    };
    if !content_type.is_empty() && !is_expected_type {
      continue;
    }

    let ext = infer_extension(url, Some(content_type), default_ext);
    let file_path = root_dir.join(format!("{}_{:02}.{}", file_prefix, saved_count + 1, ext));
    let bytes = probe
      .bytes()
      .await
      .map_err(|e| format!("read body failed for {}: {}", url, e))?;

    if bytes.len() < if expect_video { 4096 } else { 512 } {
      continue;
    }
    if !is_supported_magic(&bytes, expect_video) {
      continue;
    }

    if fs::write(&file_path, &bytes).is_ok() {
      saved_count += 1;
    }
  }

  Ok(saved_count)
}

fn write_download_record(
  root_dir: &Path,
  input: &DownloadAssetsInput,
  main_count: usize,
  color_count: usize,
  detail_count: usize,
  video_count: usize,
) -> Result<Option<String>, String> {
  if !input.write_record.unwrap_or(false) {
    return Ok(None);
  }

  let record_path = root_dir.join("record.json");
  let payload = serde_json::json!({
    "task_id": input.task_id,
    "source_url": input.source_url,
    "title": input.title,
    "saved_dir": root_dir.display().to_string(),
    "saved_at": chrono::Utc::now().to_rfc3339(),
    "options": {
      "include_main": input.include_main.unwrap_or(false),
      "include_color": input.include_color.unwrap_or(false),
      "include_detail": input.include_detail.unwrap_or(false),
      "include_video": input.include_video.unwrap_or(false),
      "dedupe_color": input.dedupe_color.unwrap_or(false),
      "write_record": input.write_record.unwrap_or(false),
    },
    "counts": {
      "main": main_count,
      "color": color_count,
      "detail": detail_count,
      "video": video_count,
    }
  });

  let content = serde_json::to_vec_pretty(&payload)
    .map_err(|e| format!("failed to serialize record: {}", e))?;
  fs::write(&record_path, content)
    .map_err(|e| format!("failed to write record file: {}", e))?;
  Ok(Some(record_path.display().to_string()))
}

#[tauri::command]
async fn download_assets(input: DownloadAssetsInput) -> Result<DownloadAssetsOutput, String> {
  let root_dir = resolve_download_dir(&input.task_id, input.title.as_deref())?;
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|e| format!("failed to create download client: {}", e))?;

  let target = input.target.clone().unwrap_or_else(|| "all".to_string());
  let include_main = input.include_main.unwrap_or(target == "all" || target == "main");
  let include_color = input.include_color.unwrap_or(target == "all" || target == "color");
  let include_detail = input.include_detail.unwrap_or(target == "all" || target == "detail");
  let include_video = input.include_video.unwrap_or(target == "all" || target == "video");

  let main_count = if include_main {
    download_group(&client, &input.main_images, &root_dir, "cover", "main", "jpg").await?
  } else {
    0
  };

  let color_urls = if input.dedupe_color.unwrap_or(false) {
    let mut seen = HashSet::new();
    input
      .color_images
      .iter()
      .filter(|url| seen.insert(normalize_asset_key(url)))
      .cloned()
      .collect::<Vec<_>>()
  } else {
    input.color_images.clone()
  };

  let color_count = if include_color {
    download_group(&client, &color_urls, &root_dir, "sku", "sku", "jpg").await?
  } else {
    0
  };

  let detail_count = if include_detail {
    download_group(&client, &input.detail_images, &root_dir, "detail", "detail", "jpg").await?
  } else {
    0
  };

  let video_count = if include_video && input.video_url.as_deref().is_some() {
    download_group(
      &client,
      &[input.video_url.clone().unwrap_or_default()],
      &root_dir,
      "video",
      "video",
      "mp4",
    )
    .await?
  } else {
    0
  };

  let record_path = write_download_record(
    &root_dir,
    &input,
    main_count,
    color_count,
    detail_count,
    video_count,
  )?;

  Ok(DownloadAssetsOutput {
    saved_dir: root_dir.display().to_string(),
    main_count,
    color_count,
    detail_count,
    video_count,
    record_path,
  })
}

#[tauri::command]
async fn open_path(path: String) -> Result<bool, String> {
  let target = PathBuf::from(path);
  if !target.exists() {
    return Err(format!("path not found: {}", target.display()));
  }

  #[cfg(target_os = "macos")]
  let mut command = {
    let mut cmd = Command::new("open");
    cmd.arg(&target);
    cmd
  };

  #[cfg(target_os = "windows")]
  let mut command = {
    let mut cmd = Command::new("explorer");
    cmd.arg(&target);
    cmd
  };

  #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
  let mut command = {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(&target);
    cmd
  };

  command
    .spawn()
    .map_err(|e| format!("failed to open path: {}", e))?;
  Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AppState { backend_child: Mutex::new(None) })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![ensure_backend, backend_request, download_assets, open_path])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        let state = app_handle.state::<AppState>();
        let child = state.backend_child.lock().ok()
          .and_then(|mut g| g.take());
        drop(state);
        if let Some(mut c) = child {
          let _ = c.kill();
        }
      }
    });
}
