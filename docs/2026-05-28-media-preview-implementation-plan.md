# Media Preview Support Plan

## Summary

Implement app-wide file previews for supported non-text files opened through the existing file/editor flow. The first production slice covers PNG, JPEG, GIF, WebP, SVG, BMP, AVIF, and PDF. Supported files open in the existing file tab/editor surface, replacing the current `Binary file · preview not supported` state with a read-only preview UI. Unsupported binaries keep the existing fallback.

Execution starts with this document, then implementation should proceed in small commits. Each commit should include:

```text
Co-authored-by: Codex <codex@openai.com>
```

External research notes:

- Use `pdfjs-dist` directly instead of `react-pdf`.
- `pdfjs-dist` latest was `5.7.284` when this plan was written.
- `react-pdf 10.4.1` pins `pdfjs-dist 5.4.296`, so direct PDF.js avoids an extra wrapper and version lag.
- References: https://www.npmjs.com/package/pdfjs-dist and https://www.npmjs.com/package/react-pdf.

## Phase 1: Preview Routing And Native File API

Add a native preview read path separate from `fs_read_file`, so text editing behavior stays stable.

Create a Rust command like `fs_read_preview_file(path, workspace)` that:

- Reuses workspace path resolution from the existing fs module.
- Stats the file and enforces `MAX_PREVIEW_BYTES = 50 MB`.
- Reads only supported preview types.
- Returns `kind: "preview"` with `previewType: "image" | "pdf"`, `mediaType`, `size`, `fileName`, and `dataBase64`.
- Returns `kind: "unsupported"` with `size` and a short reason.
- Returns `kind: "toolarge"` with `size`, `limit`, and best-known preview type/media type.
- Does not change `fs_read_file` semantics.

Classification rules:

- Prefer signature sniffing for PNG, JPEG, GIF, WebP, BMP, and PDF.
- Use extension fallback for AVIF and SVG.
- SVG must be treated as `image/svg+xml` only when extension is `.svg` or `.svgz`; render via `<img>`, not injected HTML.
- Unknown binaries remain unsupported.
- Existing text files keep opening in CodeMirror unless they are explicitly preview-preferred formats like SVG.

Register the command in Tauri's invoke handler and add the frontend type wrapper in a new preview-native helper.

## Phase 2: Editor Surface Integration

Keep the existing `EditorTab` type and `openFileTab` behavior. Do not add a new tab kind for v1.

Extend `EditorPane` behavior:

- Determine preview intent from the path before choosing the main surface.
- For previewable extensions, load through `fs_read_preview_file`.
- For normal text files, keep using `useDocument` exactly as today.
- For unsupported binaries and oversized files, keep the current centered fallback style, but improve the message with file type/size where available.
- Preserve `EditorPaneHandle`:
  - `reload()` reloads preview data when in preview mode.
  - `focus()` focuses the preview root.
  - `getSelection()` returns `null` in preview mode.
  - `undo()` and `redo()` are no-ops in preview mode.
- Existing watcher reload behavior continues to work because preview files still live in `editor` tabs.

UI model:

- Same rounded editor container.
- Compact preview toolbar at the top for supported files.
- Toolbar shows file name, type, size, and relevant controls.
- No nested cards.
- Preview area is dense, utilitarian, and consistent with the IDE shell.

## Phase 3: Image Preview

Build an `ImagePreviewPane` for image preview results.

Behavior:

- Decode `dataBase64` into a Blob URL on the frontend.
- Revoke old Blob URLs on reload/unmount.
- Render with `<img>` using `object-contain`.
- Support PNG, JPEG, GIF, WebP, SVG, BMP, and AVIF if the WebView can decode it.
- Animated GIF/WebP should animate naturally through `<img>`.

Controls:

- Fit to container.
- 100% actual size.
- Zoom out / zoom in.
- Reset zoom.
- Copy path.
- Reveal in file manager, using the existing opener integration.
- Error state if the browser cannot decode the image.

Defaults:

- Fit mode is default.
- Zoom range: 25% to 400%.
- Mouse wheel zoom is not required for v1.
- Pan is not required for v1; overflow scrolling is enough when zoomed.

## Phase 4: PDF Preview With PDF.js

Add `pdfjs-dist` as a direct dependency.

Implementation:

- Import PDF.js lazily only inside the PDF preview component.
- Configure the worker with Vite's asset URL pattern:

```ts
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
```

- Decode `dataBase64` into `Uint8Array`.
- Use `pdfjs.getDocument({ data })`.
- Render the active page into a `<canvas>`.
- Cancel in-flight render tasks on page/zoom/file changes.
- Destroy the PDF document on unmount.

Controls:

- Previous page.
- Next page.
- Page number input.
- Page count display.
- Zoom out / zoom in.
- Fit width toggle.
- Reset zoom.
- Copy path.
- Reveal in file manager.

Defaults:

- Fit width is default.
- Zoom range: 50% to 300%.
- Render one page at a time for v1.
- No text layer, search, thumbnails, annotations, printing, or multi-page continuous scroll in v1.
- Encrypted, invalid, or unsupported PDFs show an error panel with file name and size.

CSP expectation:

- No `iframe`, `object`, or `embed` needed.
- Existing `worker-src 'self' blob:` supports PDF.js worker assets.
- Existing `img-src blob:` supports image Blob URLs.
- No CSP relaxation should be needed unless build testing proves otherwise.

## Phase 5: Unsupported, Oversized, And Edge States

Fallback behavior must be explicit and boring:

- Unsupported binary: keep the current centered unsupported state.
- Too large: show file size and 50 MB preview limit.
- Read failure: show a destructive/error text state.
- Decode/render failure: show preview-specific error plus file metadata.
- File changed on disk: existing watcher calls `reload()`, and preview updates.
- Deleted/moved file: reload transitions to error, matching current editor behavior.

Dirty/editing behavior:

- Image/PDF previews are read-only and never dirty.
- Preview tabs opened by single-click remain transient.
- If a text-backed source mode is later added for SVG and becomes dirty, existing auto-pin behavior should still apply.
- For v1, SVG opens as preview by default; raw SVG editing can still happen by adding a later explicit "Open as Text" action if needed.

Out of scope for v1:

- Audio/video previews.
- Office document previews.
- Git binary diff image previews.
- Drag/drop fixes.
- PDF text selection/search.
- Editing image metadata or PDF content.

## Phase 6: Tests, Build, And Acceptance

Add Rust unit tests for preview classification:

- PNG signature.
- JPEG signature.
- GIF signature.
- WebP signature.
- BMP signature.
- PDF signature.
- SVG extension fallback.
- Unsupported binary fallback.
- Too-large result.

Add TypeScript unit tests for pure frontend helpers:

- Extension-to-preview intent.
- Base64-to-Blob URL helper shape.
- Format bytes/type labels.
- Zoom clamp logic.
- Page number clamp logic.

Add a light source-level test if needed for PDF worker wiring, similar to the existing preview iframe security test style.

Run verification:

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles deb --no-sign
```

Manual acceptance scenarios:

- Open `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.avif`.
- Open a normal PDF.
- Open a multi-page PDF and navigate pages.
- Open a large file over 50 MB and see the oversized message.
- Open an unsupported binary and see the existing fallback.
- Single-click image/PDF in explorer replaces the transient preview tab.
- Right-click Open pins the tab.
- Modify a previewed file externally and confirm reload updates the preview.
- Confirm normal source files still open in CodeMirror and save/autosave behavior is unchanged.
- Confirm markdown preview behavior is unchanged.

## Commit Plan

Use small commits with `Co-authored-by: Codex <codex@openai.com>`:

1. `docs(preview): add media preview implementation plan`
2. `feat(fs): add media preview file reader`
3. `feat(editor): route supported files to preview surface`
4. `feat(editor): add image preview controls`
5. `feat(editor): add pdf preview with pdfjs`
6. `test(preview): cover media classification and preview helpers`
7. `build(preview): rebuild packaged app`

Push only after the feature is built and tested, unless explicitly requested earlier.

## Assumptions

- The preview UX is "same editor/file tab," not a separate preview tab kind.
- V1 supports Images + PDF only.
- PDF.js is mandatory for reliable Linux/Tauri behavior.
- This file is the canonical implementation plan for the feature.
- The existing app styling should remain quiet and work-focused, not a decorative media gallery.
