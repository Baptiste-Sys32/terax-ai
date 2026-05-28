# Release Builds

Use the narrow bundle scripts for local verification. They avoid unrelated
AppImage tooling and updater-signing failures when you only need one artifact.

```bash
pnpm build:frontend
pnpm build:deb
```

Full Linux bundling remains available:

```bash
pnpm build:linux:all
```

Updater signing is intentionally separate from local packaging. Configure the
Tauri signing environment only for release publishing:

```bash
TAURI_SIGNING_PRIVATE_KEY=...
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
```

If AppImage creation fails locally, verify the `.deb` first and install
`linuxdeploy`/AppImage tooling before running `pnpm build:appimage`.
