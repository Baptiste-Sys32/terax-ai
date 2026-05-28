# Codex Integration Handoff

## Done

- Found the custom Terax/Codex build in this repo:
  `/home/badeparday/Documents/github-repos/terax-ai`.
- Added a Downloads launcher:
  `/home/badeparday/Downloads/Terax Codex Custom.desktop`.
- Added/kept Codex integration files:
  - `public/codex_dark.svg`
  - `src/modules/codex/`
  - `src-tauri/src/modules/codex.rs`
  - `src/settings/sections/CodexSection.tsx`
- Normalized OpenAI model labels to use `GPT` casing.
- Set the regular AI default model to `gpt-5.5`.
- Set the Codex composer initial/default model to `gpt-5.5`.
- Set the Codex composer initial/default reasoning effort to `low`.
- Hid the bottom-right Terax/OpenAI mini agent window when the active tab is a Codex tab.
- Added a Codex slash-command palette in the Codex composer for:
  - `/status`
  - `/model`
  - `/compact`
  - `/clear`
  - `/help`
- Added local handling for `/status`, `/compact`, and `/help`.
- Added `Ctrl+O` as a shortcut for opening a new Codex tab, and showed it in the plus menu.
- Built a release binary and deb package at:
  - `src-tauri/target/release/terax`
  - `src-tauri/target/release/bundle/deb/Terax_0.7.3_amd64.deb`

## Todo

Make the Terax Codex GUI behave more like the Codex CLI for session lifecycle commands.

The Codex app-server already exposes the local endpoints needed:

- `thread/start`
- `thread/list`
- `thread/resume`
- `thread/fork`
- `thread/compact/start`
- `account/rateLimits/read`

Commands to implement:

- `/new`
  - Start a fresh Codex chat in the current Codex tab.
  - Keep the previous thread resumable by id.

- New chat GUI button
  - Add a visible new-chat button at the far left of the Codex composer toolbar.
  - Shift the model/reasoning/permission selectors slightly to the right.
  - The button should start a fresh Codex chat in the GUI, matching the future `/new` behavior.

- Account switching
  - When switching Codex accounts from the top-right account selector, automatically start a fresh chat.
  - Existing chats should remain resumable under the account they belong to.
  - This avoids continuing an old account-specific thread after the active account changes.

- Attach files, folders, and images to Codex
  - Terax already has an `attach to agent` action from the left file/sidebar.
  - When a Codex tab is active, that action should attach the selected file or folder to the Codex chat instead of the regular Terax agent.
  - Pasted images in the Codex composer should be attached to the Codex chat.
  - File, folder, and image attachments should behave like the Codex CLI attachment flow as closely as the Codex app-server allows.
  - Audit both codebases before implementation to confirm what attachment payloads Codex app-server accepts and what Terax currently sends to its regular agent.

- `/resume`
  - Open an in-app recent session browser using `thread/list`.
  - Show title/preview, cwd, updated time, source, and thread id.
  - Clicking a session should resume it in the current Codex tab.

- `/resume <id>`
  - Resume a specific Codex session using `thread/resume`.
  - Load the returned thread turns into the current chat view.

- `/fork`
  - Branch the current chat using `thread/fork`.
  - Load the forked thread in the current Codex tab.

- `/exit`
  - Do not quit Terax.
  - Show the current resume id, similar to the CLI message:
    `To continue this session, use /resume <thread-id>`.

- `/model`
  - Currently appears in the slash palette but is not handled when submitted.
  - Should open or focus model controls.

- `/clear`
  - Currently appears in the slash palette but is not handled when submitted.
  - Should clear/detach the current visible chat state.

Likely files:

- `src/modules/codex/components/CodexChatView.tsx`
- `src/modules/codex/index.ts`
- `src/modules/codex/lib/chatState.ts`

Likely reducer additions:

- `reset` to return `createInitialCodexChatState()`.
- `thread-loaded` to replace the current chat state with a resumed/forked thread id and flattened items.

Useful app-server params:

- `thread/list`:
  `{ limit: 30, sortKey: "updated_at", sortDirection: "desc", archived: false }`
- `thread/resume`:
  `{ threadId, cwd, model, approvalPolicy, sandbox }`
- `thread/fork`:
  `{ threadId, cwd, model, approvalPolicy, sandbox }`

## Testing

Do not do the final app compile until requested.

Smoke tests are okay:

```bash
pnpm exec tsc --noEmit
```
