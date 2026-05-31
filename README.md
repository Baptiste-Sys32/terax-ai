# Terax AI

Terax AI is a custom Codex-integrated Agentic Development Environment (ADE). It is a specialized fork of Terax reshaped around a unified, keyboard-driven development workflow: a high-performance terminal, advanced code editor, visual source control, web preview, and deep agent sessions co-exist in a single desktop interface rather than scattered across separate tools and tabs.

This fork is specifically designed to treat agentic coding assistants (like Codex) as first-class, stateful workspace elements, providing them with rich environmental context, robust security boundaries, and high-fidelity control interfaces.

## What This Fork Adds

* **First-Class Codex Workspace Tab** - Integrated dedicated interface for agent interactions rather than relying on floating windows or external terminals.
* **Persistent Agent Sessions** - Session state and context trees persist across workspace views and application reloads.
* **Context Bridging and Attachment Plumbing** - Real-time state synchronization allowing agents to access open editor buffers, terminal history, workspace file selections, and direct image/clipboard paste context.
* **Hardened Security Sandbox** - Enhanced workspace authorization layer enforcing read/write restrictions on system paths, environment credentials, and private directories.
* **Built-in Media and Web Previews** - Direct inline rendering of supported assets and automatic discovery of localhost web servers inside preview panels.
* **Large-File Performance Diagnostics** - Optimizations to handle dense project files and heavy command logs efficiently.

## Upstream

This project is a fork of crynta/terax-ai:
https://github.com/crynta/terax-ai

## License

Licensed under Apache-2.0. See the `LICENSE` file for more details.
