use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_CODEX_PROFILE_ID: &str = "default";
const CODEX_ACCOUNTS_FILE: &str = "terax-codex-accounts.json";
const CODEX_ACCOUNTS_DIR: &str = "codex-accounts";

#[derive(Default)]
pub struct CodexState {
    bridge: Mutex<Option<Arc<CodexBridge>>>,
    active_profile_id: Mutex<Option<String>>,
    last_bridge_error: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    installed: bool,
    version: Option<String>,
    account: Option<Value>,
    accounts: Vec<CodexAccountProfile>,
    active_account_id: String,
    requires_openai_auth: Option<bool>,
    detail: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountProfile {
    id: String,
    label: String,
    home: String,
    account: Option<Value>,
    active: bool,
    managed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDebugStatus {
    codex_home: String,
    active_account_id: String,
    active_account_label: String,
    active_account_home: String,
    codex_bin: Option<String>,
    cli_version: Option<String>,
    app_server_healthy: bool,
    last_bridge_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredCodexProfile {
    id: String,
    label: String,
    home: PathBuf,
    managed: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CodexAccountsConfig {
    active_profile_id: Option<String>,
    profiles: Vec<StoredCodexProfile>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CodexLoginStartResponse {
    Browser {
        login_id: String,
        auth_url: String,
    },
    Device {
        login_id: String,
        verification_url: String,
        user_code: String,
    },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexEvent {
    kind: String,
    id: Option<Value>,
    method: String,
    params: Value,
}

#[derive(Deserialize)]
struct AccountReadResponse {
    account: Option<Value>,
    #[serde(rename = "requiresOpenaiAuth")]
    requires_openai_auth: bool,
}

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;

struct CodexBridge {
    profile_id: String,
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: PendingMap,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
}

impl Drop for CodexBridge {
    fn drop(&mut self) {
        if let Ok(mut stdin) = self.stdin.lock() {
            let _ = stdin.take();
        }
        if let Ok(mut child) = self.child.lock() {
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                thread::sleep(Duration::from_millis(25));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub async fn codex_status(app: AppHandle) -> CodexStatus {
    match blocking_codex(app, |app, state| codex_status_blocking(app, state)).await {
        Ok(status) => status,
        Err(detail) => CodexStatus {
            installed: false,
            version: None,
            account: None,
            accounts: Vec::new(),
            active_account_id: DEFAULT_CODEX_PROFILE_ID.into(),
            requires_openai_auth: None,
            detail: Some(detail),
        },
    }
}

#[tauri::command]
pub async fn codex_login_start(app: AppHandle) -> Result<CodexLoginStartResponse, String> {
    blocking_codex(app, |app, state| {
        let (bin, _) = detect_codex().ok_or_else(|| {
            "Codex CLI was not found on PATH or common install locations.".to_string()
        })?;
        let profile = active_profile(&app, state)?;
        let bridge = ensure_bridge(&app, state, &bin, &profile)?;
        let result = bridge.request("account/login/start", json!({ "type": "chatgpt" }))?;
        parse_login_start_response(result)
    })
    .await
}

#[tauri::command]
pub async fn codex_login_cancel(app: AppHandle, login_id: String) -> Result<(), String> {
    blocking_codex(app, move |app, state| {
        let (bin, _) = detect_codex().ok_or_else(|| {
            "Codex CLI was not found on PATH or common install locations.".to_string()
        })?;
        let profile = active_profile(&app, state)?;
        let bridge = ensure_bridge(&app, state, &bin, &profile)?;
        let _ = bridge.request("account/login/cancel", json!({ "loginId": login_id }))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn codex_logout(app: AppHandle) -> Result<(), String> {
    blocking_codex(app, |app, state| {
        let (bin, _) = detect_codex().ok_or_else(|| {
            "Codex CLI was not found on PATH or common install locations.".to_string()
        })?;
        let profile = active_profile(&app, state)?;
        let bridge = ensure_bridge(&app, state, &bin, &profile)?;
        let _ = bridge.request("account/logout", Value::Null)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn codex_app_request(
    app: AppHandle,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    blocking_codex(app, move |app, state| {
        let (bin, _) = detect_codex().ok_or_else(|| {
            "Codex CLI was not found on PATH or common install locations.".to_string()
        })?;
        let profile = active_profile(&app, state)?;
        let bridge = ensure_bridge(&app, state, &bin, &profile)?;
        let result = bridge.request(&method, params.unwrap_or(Value::Null));
        if let Err(err) = &result {
            set_last_bridge_error(state, err.clone());
        }
        result
    })
    .await
}

#[tauri::command]
pub async fn codex_app_respond(
    app: AppHandle,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    blocking_codex(app, move |app, state| {
        let (bin, _) = detect_codex().ok_or_else(|| {
            "Codex CLI was not found on PATH or common install locations.".to_string()
        })?;
        let profile = active_profile(&app, state)?;
        let bridge = ensure_bridge(&app, state, &bin, &profile)?;
        let response = bridge.respond(request_id, result);
        if let Err(err) = &response {
            set_last_bridge_error(state, err.clone());
        }
        response
    })
    .await
}

#[tauri::command]
pub async fn codex_debug_status(app: AppHandle) -> Result<CodexDebugStatus, String> {
    blocking_codex(app, |app, state| {
        let active_profile = active_profile(&app, state)?;
        let accounts = account_profiles(&app, &active_profile.id)?;
        let active_account_label = accounts
            .iter()
            .find(|account| account.id == active_profile.id)
            .map(|account| account.label.clone())
            .unwrap_or_else(|| active_profile.label.clone());
        let detected = detect_codex();
        let app_server_healthy = state
            .bridge
            .lock()
            .map_err(|_| "Codex bridge lock was poisoned".to_string())?
            .as_ref()
            .map(|bridge| bridge.alive.load(Ordering::Relaxed))
            .unwrap_or(false);
        let last_bridge_error = state
            .last_bridge_error
            .lock()
            .map_err(|_| "Codex bridge-error lock was poisoned".to_string())?
            .clone();

        Ok(CodexDebugStatus {
            codex_home: default_codex_home().display().to_string(),
            active_account_id: active_profile.id,
            active_account_label,
            active_account_home: active_profile.home.display().to_string(),
            codex_bin: detected.as_ref().map(|(bin, _)| bin.display().to_string()),
            cli_version: detected.map(|(_, version)| version),
            app_server_healthy,
            last_bridge_error,
        })
    })
    .await
}

async fn blocking_codex<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(AppHandle, &CodexState) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CodexState>();
        f(app.clone(), &state)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn default_codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

fn accounts_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir.join(CODEX_ACCOUNTS_FILE))
}

fn managed_accounts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(CODEX_ACCOUNTS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn load_accounts_config(app: &AppHandle) -> Result<CodexAccountsConfig, String> {
    let path = accounts_config_path(app)?;
    if !path.exists() {
        return Ok(CodexAccountsConfig::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse {}: {e}", path.display()))
}

fn save_accounts_config(app: &AppHandle, config: &CodexAccountsConfig) -> Result<(), String> {
    let path = accounts_config_path(app)?;
    let bytes = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))
}

fn stored_profiles(app: &AppHandle) -> Result<Vec<StoredCodexProfile>, String> {
    let mut config = load_accounts_config(app)?;
    config
        .profiles
        .retain(|profile| profile.id != DEFAULT_CODEX_PROFILE_ID);

    let mut profiles = vec![StoredCodexProfile {
        id: DEFAULT_CODEX_PROFILE_ID.into(),
        label: "Default".into(),
        home: default_codex_home(),
        managed: false,
    }];
    profiles.extend(config.profiles);
    Ok(profiles)
}

fn active_profile(app: &AppHandle, state: &CodexState) -> Result<StoredCodexProfile, String> {
    let profiles = stored_profiles(app)?;
    let configured = state
        .active_profile_id
        .lock()
        .map_err(|_| "Codex active-account lock was poisoned".to_string())?
        .clone()
        .or_else(|| {
            load_accounts_config(app)
                .ok()
                .and_then(|config| config.active_profile_id)
        })
        .unwrap_or_else(|| DEFAULT_CODEX_PROFILE_ID.into());

    profiles
        .iter()
        .find(|profile| profile.id == configured)
        .cloned()
        .or_else(|| profiles.first().cloned())
        .ok_or_else(|| "No Codex account profiles are available".to_string())
}

fn set_active_profile(
    app: &AppHandle,
    state: &CodexState,
    profile_id: &str,
) -> Result<(), String> {
    let profiles = stored_profiles(app)?;
    if !profiles.iter().any(|profile| profile.id == profile_id) {
        return Err(format!("Unknown Codex account profile `{profile_id}`"));
    }

    let mut config = load_accounts_config(app)?;
    config.active_profile_id = Some(profile_id.to_string());
    save_accounts_config(app, &config)?;
    *state
        .active_profile_id
        .lock()
        .map_err(|_| "Codex active-account lock was poisoned".to_string())? =
        Some(profile_id.to_string());
    *state
        .bridge
        .lock()
        .map_err(|_| "Codex bridge lock was poisoned".to_string())? = None;
    clear_last_bridge_error(state);
    Ok(())
}

fn create_account_profile(
    app: &AppHandle,
    state: &CodexState,
    label: Option<String>,
) -> Result<CodexAccountProfile, String> {
    let mut config = load_accounts_config(app)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let id = format!("account-{now}");
    let home = managed_accounts_dir(app)?.join(&id);
    fs::create_dir_all(&home).map_err(|e| format!("create {}: {e}", home.display()))?;

    let source_config = active_profile(app, state)?.home.join("config.toml");
    let target_config = home.join("config.toml");
    if source_config.exists() && !target_config.exists() {
        let _ = fs::copy(&source_config, &target_config);
    }

    let profile = StoredCodexProfile {
        id: id.clone(),
        label: label
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "New account".into()),
        home,
        managed: true,
    };
    config.profiles.push(profile.clone());
    config.active_profile_id = Some(id.clone());
    save_accounts_config(app, &config)?;
    *state
        .active_profile_id
        .lock()
        .map_err(|_| "Codex active-account lock was poisoned".to_string())? = Some(id.clone());
    *state
        .bridge
        .lock()
        .map_err(|_| "Codex bridge lock was poisoned".to_string())? = None;
    clear_last_bridge_error(state);

    Ok(profile_to_account_profile(&profile, &id, None))
}

fn account_profiles(app: &AppHandle, active_id: &str) -> Result<Vec<CodexAccountProfile>, String> {
    account_profiles_with_active_account(app, active_id, None)
}

fn account_profiles_with_active_account(
    app: &AppHandle,
    active_id: &str,
    active_account: Option<Value>,
) -> Result<Vec<CodexAccountProfile>, String> {
    let profiles = stored_profiles(app)?;
    Ok(profiles
        .into_iter()
        .map(|profile| {
            let account = if profile.id == active_id {
                active_account
                    .clone()
                    .or_else(|| read_account_from_auth_file(&profile.home))
            } else {
                read_account_from_auth_file(&profile.home)
            };
            profile_to_account_profile(&profile, active_id, account)
        })
        .collect())
}

fn profile_to_account_profile(
    profile: &StoredCodexProfile,
    active_id: &str,
    account: Option<Value>,
) -> CodexAccountProfile {
    CodexAccountProfile {
        id: profile.id.clone(),
        label: account
            .as_ref()
            .and_then(account_label)
            .unwrap_or_else(|| profile.label.clone()),
        home: profile.home.display().to_string(),
        account,
        active: profile.id == active_id,
        managed: profile.managed,
    }
}

fn account_label(account: &Value) -> Option<String> {
    match account.get("type").and_then(Value::as_str) {
        Some("chatgpt") => account
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string),
        Some("apiKey") => Some("OpenAI API key".into()),
        Some("amazonBedrock") => Some("Amazon Bedrock".into()),
        Some(other) => Some(other.to_string()),
        None => None,
    }
}

fn read_account_from_auth_file(home: &Path) -> Option<Value> {
    let auth = fs::read_to_string(home.join("auth.json")).ok()?;
    let value: Value = serde_json::from_str(&auth).ok()?;
    let mode = value.get("auth_mode").and_then(Value::as_str)?;
    match mode {
        "chatgpt" => {
            let tokens = value.get("tokens")?;
            let email = tokens
                .get("id_token")
                .and_then(Value::as_str)
                .and_then(email_from_jwt)
                .unwrap_or_else(|| {
                    tokens
                        .get("account_id")
                        .and_then(Value::as_str)
                        .map(|id| format!("ChatGPT {}", short_id(id)))
                        .unwrap_or_else(|| "ChatGPT".into())
                });
            Some(json!({ "type": "chatgpt", "email": email, "planType": "unknown" }))
        }
        "api_key" | "apiKey" => Some(json!({ "type": "apiKey" })),
        _ => None,
    }
}

fn email_from_jwt(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = decode_base64_url(payload)?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn short_id(id: &str) -> &str {
    let start = id.len().saturating_sub(6);
    &id[start..]
}

fn decode_base64_url(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

#[tauri::command]
pub async fn codex_account_switch(app: AppHandle, profile_id: String) -> Result<CodexStatus, String> {
    blocking_codex(app, move |app, state| {
        set_active_profile(&app, state, &profile_id)?;
        codex_status_blocking(app, state)
    })
    .await
}

#[tauri::command]
pub async fn codex_account_create(
    app: AppHandle,
    label: Option<String>,
) -> Result<CodexAccountProfile, String> {
    blocking_codex(app, move |app, state| create_account_profile(&app, state, label)).await
}

fn codex_status_blocking(app: AppHandle, state: &CodexState) -> Result<CodexStatus, String> {
    let active_profile = active_profile(&app, state)?;
    let accounts = account_profiles(&app, &active_profile.id)?;
    let Some((bin, version)) = detect_codex() else {
        return Ok(CodexStatus {
            installed: false,
            version: None,
            account: None,
            accounts,
            active_account_id: active_profile.id,
            requires_openai_auth: None,
            detail: Some("Codex CLI was not found on PATH or common install locations.".into()),
        });
    };

    Ok(match ensure_bridge(&app, state, &bin, &active_profile)
        .and_then(|bridge| request_account_read(&bridge, false))
    {
        Ok(account) => {
            let account_value = account.account;
            let accounts = account_profiles_with_active_account(
                &app,
                &active_profile.id,
                account_value.clone(),
            )?;
            CodexStatus {
                installed: true,
                version: Some(version),
                account: account_value,
                accounts,
                active_account_id: active_profile.id,
                requires_openai_auth: Some(account.requires_openai_auth),
                detail: None,
            }
        }
        Err(err) => CodexStatus {
            installed: true,
            version: Some(version),
            account: None,
            accounts,
            active_account_id: active_profile.id,
            requires_openai_auth: None,
            detail: Some(err),
        },
    })
}

fn ensure_bridge(
    app: &AppHandle,
    state: &CodexState,
    bin: &PathBuf,
    profile: &StoredCodexProfile,
) -> Result<Arc<CodexBridge>, String> {
    let mut guard = state
        .bridge
        .lock()
        .map_err(|_| "Codex bridge lock was poisoned".to_string())?;

    if let Some(existing) = guard.as_ref() {
        if existing.alive.load(Ordering::Relaxed) && existing.profile_id == profile.id {
            return Ok(Arc::clone(existing));
        }
    }

    let bridge = CodexBridge::spawn(app.clone(), bin, profile).map_err(|err| {
        set_last_bridge_error(state, err.clone());
        err
    })?;
    clear_last_bridge_error(state);
    *guard = Some(Arc::clone(&bridge));
    Ok(bridge)
}

fn set_last_bridge_error(state: &CodexState, error: String) {
    if let Ok(mut last) = state.last_bridge_error.lock() {
        *last = Some(error);
    }
}

fn clear_last_bridge_error(state: &CodexState) {
    if let Ok(mut last) = state.last_bridge_error.lock() {
        *last = None;
    }
}

fn request_account_read(
    bridge: &CodexBridge,
    refresh_token: bool,
) -> Result<AccountReadResponse, String> {
    let value = bridge.request(
        "account/read",
        json!({ "refreshToken": refresh_token }),
    )?;
    serde_json::from_value(value).map_err(|e| format!("Invalid Codex account response: {e}"))
}

impl CodexBridge {
    fn spawn(
        app: AppHandle,
        bin: &PathBuf,
        profile: &StoredCodexProfile,
    ) -> Result<Arc<Self>, String> {
        fs::create_dir_all(&profile.home)
            .map_err(|e| format!("create {}: {e}", profile.home.display()))?;
        let mut cmd = Command::new(bin);
        cmd.arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .env("CODEX_HOME", &profile.home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::modules::proc::hide_console(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to start `{} app-server`: {e}",
                bin.to_string_lossy()
            )
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server stdin was unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server stdout was unavailable".to_string())?;
        let stderr = child.stderr.take();

        let bridge = Arc::new(Self {
            profile_id: profile.id.clone(),
            child: Mutex::new(child),
            stdin: Mutex::new(Some(stdin)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            alive: Arc::new(AtomicBool::new(true)),
        });

        spawn_stdout_reader(
            app,
            Arc::clone(&bridge.pending),
            Arc::clone(&bridge.alive),
            stdout,
        );
        if let Some(stderr) = stderr {
            spawn_stderr_reader(stderr);
        }

        let _ = bridge.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "terax",
                    "title": "Terax",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false,
                },
            }),
        )?;
        bridge.notify("initialized", json!({}))?;
        Ok(bridge)
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.alive.load(Ordering::Relaxed) {
            return Err("Codex app-server is not running".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "Codex pending-request lock was poisoned".to_string())?
            .insert(id, tx);

        let msg = if params.is_null() {
            json!({ "method": method, "id": id })
        } else {
            json!({ "method": method, "id": id, "params": params })
        };

        if let Err(err) = self.write_message(&msg) {
            let _ = self
                .pending
                .lock()
                .map(|mut pending| pending.remove(&id));
            return Err(err);
        }

        match rx.recv_timeout(REQUEST_TIMEOUT) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = self
                    .pending
                    .lock()
                    .map(|mut pending| pending.remove(&id));
                Err(format!("Timed out waiting for Codex response to `{method}`"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("Codex app-server response channel closed".into())
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_message(&json!({ "method": method, "params": params }))
    }

    fn respond(&self, request_id: Value, result: Value) -> Result<(), String> {
        if !self.alive.load(Ordering::Relaxed) {
            return Err("Codex app-server is not running".into());
        }
        self.write_message(&json!({ "id": request_id, "result": result }))
    }

    fn write_message(&self, value: &Value) -> Result<(), String> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| "Codex app-server stdin lock was poisoned".to_string())?;
        let stdin = stdin
            .as_mut()
            .ok_or_else(|| "Codex app-server stdin is closed".to_string())?;
        let line = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        stdin.write_all(&line).map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    }
}

fn spawn_stdout_reader(
    app: AppHandle,
    pending: PendingMap,
    alive: Arc<AtomicBool>,
    stdout: impl std::io::Read + Send + 'static,
) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => handle_server_message(&app, &pending, value),
                Err(e) => log::warn!("codex app-server emitted invalid JSON: {e}"),
            }
        }

        alive.store(false, Ordering::Relaxed);
        if let Ok(mut map) = pending.lock() {
            for (_, tx) in map.drain() {
                let _ = tx.send(Err("Codex app-server exited".into()));
            }
        }
    });
}

fn spawn_stderr_reader(stderr: impl std::io::Read + Send + 'static) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                log::warn!("codex app-server: {line}");
            }
        }
    });
}

fn handle_server_message(app: &AppHandle, pending: &PendingMap, value: Value) {
    if let Some(id_value) = value.get("id").cloned() {
        if let Some(id) = id_value.as_u64() {
            let tx = pending.lock().ok().and_then(|mut map| map.remove(&id));
            if let Some(tx) = tx {
                let result = if let Some(error) = value.get("error") {
                    Err(format_json_rpc_error(error))
                } else {
                    Ok(value.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(result);
                return;
            }
        }

        if let Some(method) = value.get("method").and_then(Value::as_str) {
            let _ = app.emit(
                "terax:codex-event",
                CodexEvent {
                    kind: "serverRequest".to_string(),
                    id: Some(id_value),
                    method: method.to_string(),
                    params: value.get("params").cloned().unwrap_or(Value::Null),
                },
            );
        }
        return;
    }

    if let Some(method) = value.get("method").and_then(Value::as_str) {
        let _ = app.emit(
            "terax:codex-event",
            CodexEvent {
                kind: "notification".to_string(),
                id: None,
                method: method.to_string(),
                params: value.get("params").cloned().unwrap_or(Value::Null),
            },
        );
    }
}

fn format_json_rpc_error(error: &Value) -> String {
    if let Some(message) = error.get("message").and_then(Value::as_str) {
        if let Some(code) = error.get("code") {
            return format!("{message} ({code})");
        }
        return message.to_string();
    }
    error.to_string()
}

fn parse_login_start_response(value: Value) -> Result<CodexLoginStartResponse, String> {
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Codex login response did not include a type".to_string())?;
    match kind {
        "chatgpt" => Ok(CodexLoginStartResponse::Browser {
            login_id: required_string(&value, "loginId")?,
            auth_url: required_string(&value, "authUrl")?,
        }),
        "chatgptDeviceCode" => Ok(CodexLoginStartResponse::Device {
            login_id: required_string(&value, "loginId")?,
            verification_url: required_string(&value, "verificationUrl")?,
            user_code: required_string(&value, "userCode")?,
        }),
        other => Err(format!("Unsupported Codex login response type `{other}`")),
    }
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Codex login response did not include `{key}`"))
}

fn detect_codex() -> Option<(PathBuf, String)> {
    let bin = find_codex_binary()?;
    let version = Command::new(&bin)
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| {
            if !out.status.success() {
                return None;
            }
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if stdout.is_empty() {
                None
            } else {
                Some(stdout)
            }
        })
        .unwrap_or_else(|| "unknown version".into());
    Some((bin, version))
}

fn find_codex_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("CODEX_BIN").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(codex_exe_name());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    for candidate in common_codex_paths() {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    Some(PathBuf::from("codex"))
        .filter(|bin| Command::new(bin).arg("--version").output().is_ok())
}

fn common_codex_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(home) = dirs::home_dir() else {
        return out;
    };

    out.push(home.join(".local/bin").join(codex_exe_name()));
    out.push(home.join(".bun/bin").join(codex_exe_name()));
    out.push(home.join(".cargo/bin").join(codex_exe_name()));
    out.push(home.join(".npm-global/bin").join(codex_exe_name()));

    let nvm_node = home.join(".nvm/versions/node");
    if let Ok(entries) = std::fs::read_dir(nvm_node) {
        let mut versions = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("bin").join(codex_exe_name()))
            .collect::<Vec<_>>();
        versions.sort();
        versions.reverse();
        out.extend(versions);
    }

    out
}

fn codex_exe_name() -> &'static str {
    if cfg!(windows) {
        "codex.exe"
    } else {
        "codex"
    }
}
