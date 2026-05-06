// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Guards the first-close tray notification so it is emitted only once per session.
static TRAY_NOTIFIED: AtomicBool = AtomicBool::new(false);

const DEFAULT_ARGS: &str = "-5 --set-ttl 5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253";
const DEFAULT_PROFILE: &str = "Global Bypass";

// ── Data structures ───────────────────────────────────────────────────────────

/// Serializable snapshot of the active engine configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub profile: String,
    pub custom_args: String,
}

impl EngineConfig {
    fn default_config() -> Self {
        Self {
            profile: DEFAULT_PROFILE.to_string(),
            custom_args: DEFAULT_ARGS.to_string(),
        }
    }

    /// Builds the GoodbyeDPI argument list from this configuration.
    fn to_args(&self, hostlist_path: &str) -> Vec<String> {
        let mut args = shlex::split(&self.custom_args).unwrap_or_default();
        if self.profile == "Smart Routing" {
            args.push("--blacklist".to_string());
            args.push(hostlist_path.to_string());
        }
        args
    }
}

/// Shared mutable state managed by Tauri.
pub struct AppState {
    pub active_engine: Mutex<Option<CommandChild>>,
    /// `Some` only while the engine process is alive.
    pub active_config: Mutex<Option<EngineConfig>>,
    /// Persists the last-used config across stop/start cycles for hotkey restart.
    pub last_config: Mutex<EngineConfig>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns the path to `breeze_list.txt` inside the app-data directory.
fn find_hostlist(app: &AppHandle) -> std::path::PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap());
    path = path.join("com.breezeflow");

    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }

    let hostlist_path = path.join("breeze_list.txt");

    if !hostlist_path.exists() {
        let content = "discord.com\ndiscord.gg\ndiscordapp.com\ndiscordapp.net\ngateway.discord.gg\ncdn.discordapp.com\ndiscord.media\n";
        let _ = std::fs::write(&hostlist_path, content);
    }
    hostlist_path
}

/// Produces a sanitized copy of `breeze_list.txt` at `clean_hostlist.txt`.
fn sanitize_hostlist(app: &AppHandle) -> std::path::PathBuf {
    let source = find_hostlist(app);
    let content = std::fs::read_to_string(&source).unwrap_or_default();

    let clean: String = content
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n");

    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap());
    path = path.join("com.breezeflow").join("clean_hostlist.txt");
    let _ = std::fs::write(&path, clean);
    path
}

/// Flushes the Windows DNS resolver cache synchronously.
fn flush_dns() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("ipconfig")
            .arg("/flushdns")
            .creation_flags(0x08000000)
            .status();
    }
}

// ── Engine helpers (shared by commands and hotkey handler) ────────────────────

/// Kills the active engine child, flushes DNS, and clears `active_config`.
fn engine_stop_inner(app: &AppHandle) {
    let state = app.state::<AppState>();
    let child = state.active_engine.lock().unwrap().take();
    if let Some(c) = child {
        let _ = c.kill();
        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("ipconfig")
            .arg("/flushdns")
            .creation_flags(0x08000000)
            .status();
    }
    *state.active_config.lock().unwrap() = None;
}

/// Stops any running engine then starts a fresh GoodbyeDPI sidecar.
async fn engine_start_inner(
    app: &AppHandle,
    profile: String,
    custom_args: String,
) -> Result<(), String> {
    engine_stop_inner(app);
    // Give the OS 300 ms to release WinDivert handles before rebinding.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    flush_dns();

    let hostlist_path = if profile == "Smart Routing" {
        sanitize_hostlist(app).to_string_lossy().to_string()
    } else {
        String::new()
    };

    let config = EngineConfig { profile, custom_args };
    let args = config.to_args(&hostlist_path);

    let sidecar = app
        .shell()
        .sidecar("goodbyedpi")
        .map_err(|e| format!("Sidecar not found: {e}"))?;

    let (_, child) = sidecar
        .args(&args)
        .spawn()
        .map_err(|e| format!("Engine failed to start: {e}"))?;

    let state = app.state::<AppState>();
    *state.active_engine.lock().unwrap() = Some(child);
    *state.active_config.lock().unwrap() = Some(config.clone());
    *state.last_config.lock().unwrap() = config;

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Reads `breeze_list.txt` and returns its content and absolute path.
#[tauri::command]
fn read_breeze_list(app: AppHandle) -> Result<serde_json::Value, String> {
    let hostlist_path = find_hostlist(&app);
    let content = std::fs::read_to_string(&hostlist_path).map_err(|e| e.to_string())?;
    let path = hostlist_path.to_string_lossy().to_string();
    Ok(serde_json::json!({ "content": content, "path": path }))
}

/// Overwrites `breeze_list.txt` with `content` as typed by the user.
#[tauri::command]
fn write_breeze_list(app: AppHandle, content: String) -> Result<(), String> {
    let hostlist_path = find_hostlist(&app);
    std::fs::write(hostlist_path, content).map_err(|e| e.to_string())
}

/// Returns the currently active engine configuration, or `null` if stopped.
#[tauri::command]
fn get_active_config(state: State<'_, AppState>) -> Result<Option<EngineConfig>, String> {
    Ok(state.active_config.lock().unwrap().clone())
}

/// Returns `true` when the process holds administrator privileges.
#[tauri::command]
async fn check_admin() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("net")
            .arg("session")
            .creation_flags(0x08000000)
            .output()
            .await;
        Ok(match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(true)
    }
}

/// Starts GoodbyeDPI with the specified routing profile and argument string.
#[tauri::command]
async fn start_engine(
    app: AppHandle,
    profile: String,
    custom_args: String,
) -> Result<(), String> {
    engine_start_inner(&app, profile, custom_args).await
}

/// Kills the running GoodbyeDPI process and flushes the DNS cache.
#[tauri::command]
async fn stop_engine(app: AppHandle) -> Result<String, String> {
    engine_stop_inner(&app);
    Ok("Engine stopped.".to_string())
}

/// Downloads a plain-text domain list from `url` and overwrites `breeze_list.txt`.
#[tauri::command]
async fn sync_list_from_cloud(app: AppHandle, url: String) -> Result<String, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let content = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    let hostlist_path = find_hostlist(&app);
    std::fs::write(&hostlist_path, &content).map_err(|e| e.to_string())?;

    Ok(content)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let is_running = app
                                .state::<AppState>()
                                .active_engine
                                .lock()
                                .unwrap()
                                .is_some();

                            if is_running {
                                engine_stop_inner(&app);
                                let _ = app.emit("shortcut-toggle", "DISABLED");
                            } else {
                                let (profile, custom_args) = {
                                    let cfg = app.state::<AppState>().last_config.lock().unwrap().clone();
                                    (cfg.profile, cfg.custom_args)
                                };
                                let label = match engine_start_inner(&app, profile, custom_args).await {
                                    Ok(_) => "ENABLED",
                                    Err(_) => "ERROR",
                                };
                                let _ = app.emit("shortcut-toggle", label);
                            }
                        });
                    }
                })
                .build(),
        )
        .manage(AppState {
            active_engine: Mutex::new(None),
            active_config: Mutex::new(None),
            last_config: Mutex::new(EngineConfig::default_config()),
        })
        .setup(|app| {
            // Register Ctrl+Shift+B as the global panic hotkey.
            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::KeyB,
            );
            app.global_shortcut().register(shortcut)?;

            let show = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Toggle Engine", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit BreezeFlow", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &toggle, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("no app icon configured — add icons to tauri.conf.json bundle.icon");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("BreezeFlow")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "toggle" => {
                        let state = app.state::<AppState>();
                        let child = state.active_engine.lock().unwrap().take();
                        if let Some(c) = child {
                            let _ = c.kill();
                            *state.active_config.lock().unwrap() = None;
                        } else {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        engine_stop_inner(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_engine,
            check_admin,
            stop_engine,
            get_active_config,
            read_breeze_list,
            write_breeze_list,
            sync_list_from_cloud,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } => {
                engine_stop_inner(app_handle);
            }
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let _ = window.hide();
                    if !TRAY_NOTIFIED.swap(true, Ordering::Relaxed) {
                        let _ = window.emit("window-hidden", ());
                    }
                }
            }
            _ => {}
        });
}
