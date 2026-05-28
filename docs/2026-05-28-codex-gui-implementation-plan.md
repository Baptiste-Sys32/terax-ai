# Terax Codex GUI Implementation Plan

## Summary

Implement the remaining Codex GUI features from `docs/2026-05-27-codex-handoff.md`. This is feasible with the current Terax bridge plus Codex app-server.

Audited sources:

- Terax Codex integration:
  - `src/modules/codex/components/CodexChatView.tsx`
  - `src/modules/codex/index.ts`
  - `src/app/App.tsx`
- Codex app-server supports `thread/start`, `thread/resume`, `thread/fork`, `thread/list`, and clear-session source metadata.
- Codex input supports `text`, `image`, `localImage`, `skill`, and `mention`.
- Codex CLI image input maps local image paths to `localImage` input.

## Key Changes

### Thread Lifecycle

Add typed Codex app-server wrappers in `src/modules/codex/index.ts`:

- `codexThreadList(params)` -> `thread/list`
- `codexThreadResume(input)` -> `thread/resume`
- `codexThreadFork(input)` -> `thread/fork`
- Extend `codexThreadStart(input)` to accept `sessionStartSource?: "startup" | "clear"` and pass it to app-server.
- Extend `codexTurnStart(input)` to accept `input: CodexUserInput[]` instead of only `text`.

Extend Codex chat state in `src/modules/codex/lib/chatState.ts`:

- Add `cwd: string | null` so resumed/forked threads keep their own cwd.
- Add reducer support for replacing loaded thread state.
- Keep old-thread events ignored through the existing `threadId` filter.
- Future `turn/start` must use `state.cwd ?? tab.cwd`, not always `tab.cwd`, to avoid overwriting resumed thread cwd.

Slash command behavior:

- `/new`: create a fresh Codex thread in the current tab, reset the visible chat, keep the previous thread resumable, and show a small resume-id notice for the previous thread.
- `/clear`: clear the entire Codex UI, silently start a fresh thread with `sessionStartSource: "clear"`, keep the previous thread resumable, and do not show the old id.
- `/exit`: do not quit Terax; show `To continue this session, use /resume <thread-id>`, then detach to a fresh empty chat state.
- `/resume`: open an in-app recent session browser using `thread/list` with `{ limit: 30, sortKey: "updated_at", sortDirection: "desc", archived: false }`.
- `/resume <id>`: call `thread/resume`, replace current state with returned turns, cwd, model, and thread id.
- `/fork`: call `thread/fork` for the current thread and replace state with the forked thread.
- `/model`: open/focus the model selector.
- `/compact`: keep current behavior.
- Disable `/new`, `/clear`, `/resume`, `/fork`, `/exit`, and the GUI new-chat button while a turn is running; show `Stop the current turn first.`

### Composer UI

Update `CodexChatView` composer toolbar:

- Add a far-left icon button for `New chat`.
- Button invokes the same fresh-thread behavior as `/new`.
- Shift model/reasoning/permission selectors to the right by placing them after the new-chat button with a small separator/gap.
- Keep send/stop button on the far right.
- Add tooltip/title text: `New chat`.

Add session browser UI inside `CodexChatView`:

- Render as an inline panel/card above the composer, not a new app window.
- Rows show preview/title, cwd, updated time, source, and short thread id.
- Clicking a row resumes that session.
- Include search/filter later only if needed; v1 shows recent current-account sessions only.

Account switching:

- After `codexAccountSwitch(profileId)` succeeds, reset Codex chat state and start a fresh thread for the new account.
- Do not carry the old thread id across accounts.
- Existing sessions remain resumable through that account's own Codex home.

### Attachments

Route existing Terax `Attach to Agent` differently when a Codex tab is active:

- In `App.tsx`, if `activeTab.kind === "codex"`, dispatch `terax:codex-attach-path` instead of `terax:ai-attach-file`.
- Do not open the regular Terax AI panel.
- Focus the Codex composer.

Add Codex composer attachment chips:

- `path` chip for files/folders selected from the sidebar.
- `image` chip for pasted images or image files.
- Chips can be removed before sending.
- Pasted clipboard images queue as chips, not immediate turns.

Send attachments to Codex:

- Files/folders: send as a leading text block listing absolute paths and kind, for example:

```text
Attached paths:
- /path/file.ts (file)
- /path/folder (folder)
```

- Do not inline full file/folder contents by default.
- Local image files from the explorer: send as `{ type: "localImage", path, detail: "high" }`.
- Pasted image blobs: send as `{ type: "image", url: dataUrl, detail: "high" }`.
- Always include the user's text as a `{ type: "text", text, text_elements: [] }` input item when present.
- Allow image-only sends if at least one image attachment exists.

Render user attachments:

- Update `CodexItem` user-message rendering to show text plus image thumbnails/path chips for `image`, `localImage`, and attached path text blocks.
- Keep existing assistant command/file-change rendering unchanged.

## Test Plan

Run smoke tests only, no final compile:

```bash
pnpm exec tsc --noEmit
```

Existing Codex chat state tests.

Add or update tests for:

- `thread-loaded` replaces state and preserves cwd.
- `/clear` resets UI and starts a thread with `sessionStartSource: "clear"`.
- `/resume <id>` loads returned turns.
- Attachment conversion creates correct Codex input arrays.
- Old-thread events are ignored after switching threads.

Manual acceptance:

- New-chat button appears far left of Codex composer toolbar.
- `/new` and button start fresh chat and old chat appears in `/resume`.
- `/clear` clears UI, opens a new chat, and does not display the old uid.
- `/exit` displays the resume command for the current thread.
- `/resume` opens recent sessions for the active account.
- `/resume <id>` restores that chat.
- Switching Codex accounts starts a fresh chat.
- Sidebar `Attach to Agent` queues a Codex attachment when Codex is active.
- Pasting an image into Codex queues a chip and sends it as image input.

## Assumptions

- `/clear` means: clear the full UI, silently create/open a fresh Codex chat, keep the old chat resumable, and do not tell the user the old uid.
- `/resume` defaults to the current active Codex account only.
- Attachments queue as chips and send with the next prompt.
- File/folder attachments are path context, not full-content inlining, because Codex app-server has first-class image input but no separate local file/folder input type.
- Final Tauri compile stays out of scope until explicitly requested.
