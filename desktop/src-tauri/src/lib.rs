use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const DEFAULT_COLLECTOR_BASE_URL: &str = "http://127.0.0.1:4318";

struct AppState {
  collector_child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
struct CollectorBootstrap {
  started: bool,
  base_url: String,
}

fn collector_working_dir() -> Result<PathBuf, String> {
  let src_tauri_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let project_root = src_tauri_dir
    .parent()
    .and_then(|p| p.parent())
    .ok_or("failed to resolve project root")?;
  let collector_dir = project_root.join("collector");
  if !collector_dir.exists() {
    return Err(format!(
      "collector directory not found: {}",
      collector_dir.display()
    ));
  }
  Ok(collector_dir)
}

fn is_child_running(child: &mut Child) -> Result<bool, String> {
  match child.try_wait().map_err(|e| e.to_string())? {
    None => Ok(true),
    Some(_) => Ok(false),
  }
}

fn spawn_collector() -> Result<Child, String> {
  let collector_dir = collector_working_dir()?;
  Command::new("npm")
    .arg("run")
    .arg("dev")
    .current_dir(collector_dir)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| format!("failed to spawn collector: {}", e))
}

fn normalize_base_url(base_url: &str) -> String {
  base_url.trim().trim_end_matches('/').to_string()
}

async fn request_collector(
  method: Method,
  base_url: &str,
  path: &str,
  body: Option<Value>,
) -> Result<Value, String> {
  let client = reqwest::Client::new();
  let url = format!("{}{}", normalize_base_url(base_url), path);
  let mut req = client.request(method, url);
  if let Some(payload) = body {
    req = req.json(&payload);
  }

  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status_ok = resp.status().is_success();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
    serde_json::json!({
      "message": text
    })
  });

  if status_ok {
    Ok(json)
  } else {
    let msg = json
      .get("message")
      .and_then(Value::as_str)
      .unwrap_or("collector request failed");
    Err(msg.to_string())
  }
}

async fn wait_for_collector_ready(base_url: &str) -> Result<(), String> {
  let timeout = Duration::from_secs(12);
  let start = std::time::Instant::now();
  let mut last_error: Option<String> = None;

  while start.elapsed() < timeout {
    match request_collector(Method::GET, base_url, "/health", None).await {
      Ok(_) => return Ok(()),
      Err(err) => last_error = Some(err),
    }
    std::thread::sleep(Duration::from_millis(250));
  }

  Err(format!(
    "collector did not become ready in time: {}",
    last_error.unwrap_or_else(|| "unknown error".to_string())
  ))
}

#[tauri::command]
async fn collector_session_status(base_url: String) -> Result<Value, String> {
  request_collector(Method::GET, &base_url, "/session/status", None).await
}

#[tauri::command]
async fn collector_open_login(base_url: String) -> Result<Value, String> {
  request_collector(Method::POST, &base_url, "/session/login/open", None).await
}

#[tauri::command]
async fn collector_collect_product(base_url: String, url: String) -> Result<Value, String> {
  request_collector(
    Method::POST,
    &base_url,
    "/collect/product",
    Some(serde_json::json!({ "url": url })),
  )
  .await
}

#[tauri::command]
async fn collector_get_task(base_url: String, task_id: String) -> Result<Value, String> {
  let path = format!("/tasks/{}", task_id);
  request_collector(Method::GET, &base_url, &path, None).await
}

#[tauri::command]
async fn collector_export_task(base_url: String, task_id: String) -> Result<Value, String> {
  let path = format!("/export/{}", task_id);
  request_collector(Method::POST, &base_url, &path, None).await
}

#[tauri::command]
async fn collector_ensure_started(
  state: tauri::State<'_, AppState>,
) -> Result<CollectorBootstrap, String> {
  {
    let mut holder = state.collector_child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = holder.as_mut() {
      if !is_child_running(child)? {
        *holder = None;
      }
    }

    if holder.is_none() {
      let child = spawn_collector()?;
      *holder = Some(child);
    }
  }

  wait_for_collector_ready(DEFAULT_COLLECTOR_BASE_URL).await?;
  Ok(CollectorBootstrap {
    started: true,
    base_url: DEFAULT_COLLECTOR_BASE_URL.to_string(),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app_state = AppState {
    collector_child: Mutex::new(None),
  };

  tauri::Builder::default()
    .manage(app_state)
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
    .invoke_handler(tauri::generate_handler![
      collector_ensure_started,
      collector_session_status,
      collector_open_login,
      collector_collect_product,
      collector_get_task,
      collector_export_task
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        let state: tauri::State<AppState> = app_handle.state();
        let lock_result = state.collector_child.lock();
        if let Ok(mut holder) = lock_result {
          if let Some(child) = holder.as_mut() {
            let _ = child.kill();
          }
        }
      }
    });
}
