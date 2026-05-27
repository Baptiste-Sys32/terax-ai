# Codex Integration Phase 1

Date: 2026-05-27

## What Changed

Phase 1 adds Codex as a local account-backed tool, not as a normal AI model provider. The existing Terax model provider flow is API-key/Vercel AI SDK based, while Codex account auth and future native chat integration are exposed through the Codex CLI `app-server` JSON-RPC protocol.

Implemented pieces:

- A Tauri backend module at `src-tauri/src/modules/codex.rs`.
- Tauri commands for Codex install/status/login/logout.
- A frontend Codex API wrapper at `src/modules/codex/index.ts`.
- A dedicated Settings tab at `Settings -> Codex`.
- A `+ -> Codex` tab menu entry that launches the Codex CLI in a terminal tab.

## What Was Achieved

The `+ -> Codex` path is working. In Terax, selecting `Codex` from the tab menu opens a new terminal tab titled `codex` and runs:

```bash
codex -C '<current cwd>'
```

If no cwd is available, it runs:

```bash
codex
```

The Settings tab can call into the backend bridge, detect the local Codex CLI, read the active Codex account, start/cancel login, and logout. The login flow is intentionally separate from the normal `Models` provider list because Codex owns its ChatGPT/API-key auth files.

## Backend Entry Points

Registered in `src-tauri/src/lib.rs`:

```rust
.manage(codex::CodexState::default())

codex::codex_status,
codex::codex_login_start,
codex::codex_login_cancel,
codex::codex_logout,
```

Module export in `src-tauri/src/modules/mod.rs`:

```rust
pub mod codex;
```

The Tauri commands currently exposed are:

```rust
#[tauri::command]
pub fn codex_status(app: AppHandle, state: State<'_, CodexState>) -> CodexStatus

#[tauri::command]
pub fn codex_login_start(
    app: AppHandle,
    state: State<'_, CodexState>,
) -> Result<CodexLoginStartResponse, String>

#[tauri::command]
pub fn codex_login_cancel(
    app: AppHandle,
    state: State<'_, CodexState>,
    login_id: String,
) -> Result<(), String>

#[tauri::command]
pub fn codex_logout(app: AppHandle, state: State<'_, CodexState>) -> Result<(), String>
```

## Codex App-Server Bridge

`src-tauri/src/modules/codex.rs` starts Codex like this:

```rust
let mut cmd = Command::new(bin);
cmd.arg("app-server")
    .arg("--listen")
    .arg("stdio://")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
```

The protocol is newline-delimited JSON-RPC without a `jsonrpc` field. Requests look like:

```json
{"method":"account/read","id":2,"params":{"refreshToken":false}}
```

The bridge:

- Starts `codex app-server --listen stdio://`.
- Sends `initialize`, then `initialized`.
- Tracks pending request IDs with a `HashMap<u64, Sender<Result<Value, String>>>`.
- Routes server notifications to the frontend with `terax:codex-event`.
- Reads account state through `account/read`.
- Starts ChatGPT OAuth through `account/login/start`.

Important request methods:

```rust
bridge.request("account/read", json!({ "refreshToken": false }))
bridge.request("account/login/start", json!({ "type": "chatgpt" }))
bridge.request("account/login/cancel", json!({ "loginId": login_id }))
bridge.request("account/logout", Value::Null)
```

Important server notifications:

```text
account/updated
account/login/completed
```

## Frontend Wrapper

`src/modules/codex/index.ts` wraps the Tauri commands:

```ts
export function codexStatus(): Promise<CodexStatus> {
  return invoke<CodexStatus>("codex_status");
}

export function codexLoginStart(): Promise<CodexLoginStartResponse> {
  return invoke<CodexLoginStartResponse>("codex_login_start");
}

export function codexLoginCancel(loginId: string): Promise<void> {
  return invoke("codex_login_cancel", { loginId });
}

export function codexLogout(): Promise<void> {
  return invoke("codex_logout");
}
```

Event subscription:

```ts
export function listenCodexEvents(
  onEvent: (event: CodexEvent) => void,
): Promise<UnlistenFn> {
  return listen<CodexEvent>("terax:codex-event", (event) => {
    onEvent(event.payload);
  });
}
```

## Settings UI

`src/settings/SettingsApp.tsx` adds the new tab:

```ts
{ id: "codex", label: "Codex", icon: AiProgrammingIcon, component: CodexSection },
```

`src/modules/settings/openSettingsWindow.ts` extends `SettingsTab`:

```ts
| "codex"
```

`src/settings/sections/CodexSection.tsx` handles:

- CLI status display.
- Current account display.
- `Login` button.
- `Cancel` button for pending browser/device login.
- `Logout` button.
- Refresh on `account/updated` and `account/login/completed`.

The login flow opens the returned URL:

```ts
const flow = await codexLoginStart();
setPendingLogin(flow);
if (flow.kind === "browser") {
  await openUrl(flow.authUrl);
} else {
  await openUrl(flow.verificationUrl);
}
```

## Codex Terminal Tab

The `+` menu entry was added in `src/modules/tabs/TabBar.tsx`:

```tsx
<DropdownMenuItem onSelect={() => onNewCodex()}>
  <HugeiconsIcon
    icon={AiProgrammingIcon}
    size={14}
    strokeWidth={1.75}
  />
  <span className="flex-1">Codex</span>
</DropdownMenuItem>
```

The callback is passed through `src/modules/header/Header.tsx` to `src/app/App.tsx`.

`src/app/App.tsx` launches Codex by reusing the existing agent terminal pattern:

```ts
const openNewCodexTab = useCallback(() => {
  const cwd = inheritedCwdForNewTab();
  const { leafId } = newAgentTab(cwd ?? undefined, "codex");
  void whenSessionReady(leafId).then(() => {
    const command = cwd ? `codex -C ${quoteShellArg(cwd)}\r` : "codex\r";
    if (writeToSession(leafId, command)) {
      terminalRefs.current.get(leafId)?.focus();
    }
  });
}, [inheritedCwdForNewTab, newAgentTab]);
```

## Verification Done

Commands that passed:

```bash
npm run build
npm test
```

Runtime launch was tested with:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run tauri -- dev
```

Notes from local setup:

- System Cargo was too old (`1.75.0`) for this repo's `Cargo.lock` version 4 and current dependencies.
- Installed Rust stable with rustup under `~/.cargo/bin`.
- Required Linux dev packages were needed for Tauri/WebKit/GTK.
- After install, the Tauri backend compiled and `target/debug/terax` launched.
- The Codex terminal tab successfully launched `codex -C '/home/badeparday'`.

## Known Notes

The user saw this warning from Codex:

```text
MCP client for `codex_apps` failed to start
Unexpected content type ... upstream connect error ... connection timeout
```

This is from the user's Codex MCP configuration, not from Terax. Codex still launches successfully.

## Next Work

Phase 2 should add a native Codex chat mode backed by the same app-server bridge. Do not route this through the existing AI provider model list.

Likely new backend commands:

```text
codex_thread_start
codex_thread_resume
codex_turn_start
codex_turn_interrupt
codex_approval_respond
```

Likely app-server methods to wrap:

```text
thread/start
thread/resume
turn/start
turn/interrupt
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/permissions/requestApproval
```

Relevant streamed notifications to map into Terax UI:

```text
thread/started
thread/status/changed
turn/started
turn/completed
item/agentMessage/delta
item/plan/delta
turn/plan/updated
command/exec/outputDelta
process/outputDelta
item/fileChange/patchUpdated
account/updated
account/login/completed
```

Suggested UI mapping:

- Assistant deltas -> Terax assistant messages.
- Plan deltas -> existing plan/todo UI concepts.
- Command output -> command cards.
- File patches -> diff/file-change cards.
- Approval requests -> existing approval UI patterns.
- Auth failures/account updates -> Codex Settings tab and chat banner/status.

Keep phase 2 separate from the current normal OpenAI API-key provider support. The existing `Models` settings should remain unchanged for normal AI SDK providers.
