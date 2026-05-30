# Terax-AI

**A Codex-integrated ADE built for actually shipping from one workspace.**

Terax-AI is my fork of Terax, reshaped around a tighter Codex workflow: terminal, editor, source control, previews, and AI sessions live in the same desktop app instead of being scattered across tabs and tools.

## What This Fork Adds

- **Codex as a first-class workspace tab** with a dedicated UI instead of treating the agent like an external side process.
- **Persistent Codex sessions and tabs** so agent work survives normal app navigation.
- **Codex session lifecycle plumbing** for starting, tracking, restoring, and managing GUI-backed agent threads.
- **Attachment handling for agent context** including file attachments and restored session payloads.
- **Native clipboard image paste fallback** for Codex workflows that need screenshots or visual context.
- **Command palette actions for Codex** so agent flows can be launched quickly from the keyboard.
- **Bridge/debug status for Codex integration** to make the agent connection state easier to inspect.
- **Media preview support** for opening supported assets directly inside the workspace.
- **Large-file editor mode and diagnostics** for more realistic project work.
- **Hardened workspace file access** around file reads and agent-accessible project paths.

## Core Workspace

- Multi-tab terminal with native PTY support.
- Code editor with language highlighting, themes, diffs, and AI edit review.
- Source control panel with git status, history, commit graph, and file diffs.
- File explorer with project navigation and attach-to-agent flows.
- Local web preview for dev servers and previewable files.
- AI provider support for OpenAI, Anthropic, Google, xAI, Groq, Cerebras, DeepSeek, Mistral, OpenRouter, OpenAI-compatible endpoints, LM Studio, MLX, and Ollama.

## Upstream

Based on Terax by crynta:

https://github.com/crynta/terax-ai

## License

Licensed under Apache-2.0. See [LICENSE](./LICENSE).
