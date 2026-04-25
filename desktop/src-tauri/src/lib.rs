use reqwest::Method;
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const BACKEND_URL: &str = "http://127.0.0.1:4318";

struct AppState {
  backend_child: Mutex<Option<Child>>,
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
    .invoke_handler(tauri::generate_handler![ensure_backend, backend_request])
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
