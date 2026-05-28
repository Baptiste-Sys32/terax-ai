use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use base64::Engine;
use serde::Serialize;
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_PREVIEW_BYTES: u64 = 50 * 1024 * 1024; // 50 MB
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
const PREVIEW_SNIFF_BYTES: usize = 16;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewType {
    Image,
    Pdf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PreviewFormat {
    preview_type: PreviewType,
    media_type: &'static str,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PreviewReadResult {
    Preview {
        #[serde(rename = "previewType")]
        preview_type: PreviewType,
        #[serde(rename = "mediaType")]
        media_type: String,
        size: u64,
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "dataBase64")]
        data_base64: String,
    },
    Unsupported {
        size: u64,
        reason: String,
    },
    TooLarge {
        size: u64,
        limit: u64,
        #[serde(rename = "previewType", skip_serializing_if = "Option::is_none")]
        preview_type: Option<PreviewType>,
        #[serde(rename = "mediaType", skip_serializing_if = "Option::is_none")]
        media_type: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

fn preview_format_from_signature(bytes: &[u8]) -> Option<PreviewFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/png",
        });
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/jpeg",
        });
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/gif",
        });
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/webp",
        });
    }
    if bytes.starts_with(b"BM") {
        return Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/bmp",
        });
    }
    if bytes.starts_with(b"%PDF-") {
        return Some(PreviewFormat {
            preview_type: PreviewType::Pdf,
            media_type: "application/pdf",
        });
    }
    None
}

fn preview_format_from_extension(path: &Path) -> Option<PreviewFormat> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    match ext.as_str() {
        "svg" | "svgz" => Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/svg+xml",
        }),
        "avif" => Some(PreviewFormat {
            preview_type: PreviewType::Image,
            media_type: "image/avif",
        }),
        _ => None,
    }
}

fn classify_preview_format(path: &Path, bytes: &[u8]) -> Option<PreviewFormat> {
    preview_format_from_signature(bytes).or_else(|| preview_format_from_extension(path))
}

fn read_preview_sniff(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0_u8; PREVIEW_SNIFF_BYTES];
    let n = f.read(&mut buf)?;
    buf.truncate(n);
    Ok(buf)
}

#[tauri::command]
pub fn fs_read_preview_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<PreviewReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_preview_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;
    let size = meta.len();
    let sniff = read_preview_sniff(&p).map_err(|e| {
        log::debug!("fs_read_preview_file sniff({}) failed: {e}", p.display());
        e.to_string()
    })?;
    let format = classify_preview_format(&p, &sniff);

    if size > MAX_PREVIEW_BYTES {
        return Ok(PreviewReadResult::TooLarge {
            size,
            limit: MAX_PREVIEW_BYTES,
            preview_type: format.map(|f| f.preview_type),
            media_type: format.map(|f| f.media_type.to_string()),
        });
    }

    let Some(format) = format else {
        return Ok(PreviewReadResult::Unsupported {
            size,
            reason: "Preview not supported for this file type.".to_string(),
        });
    };

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_preview_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;
    let file_name = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    Ok(PreviewReadResult::Preview {
        preview_type: format.preview_type,
        media_type: format.media_type.to_string(),
        size,
        file_name,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    if let Some(perms) = original_permissions {
        let _ = fs::set_permissions(&target, perms);
    }
    let _ = app.emit(
        "fs:file-written",
        FileWrittenEvent {
            path: path.clone(),
            source,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn fs_canonicalize(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    Ok(super::to_canon(&canon))
}

#[tauri::command]
pub fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        StatKind::Dir
    } else if meta.file_type().is_symlink() {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match fs_read_file(f.to_string_lossy().into_owned(), None).unwrap() {
            ReadResult::Text { content, size } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    fn classify_bytes(name: &str, bytes: &[u8]) -> Option<PreviewFormat> {
        classify_preview_format(Path::new(name), bytes)
    }

    #[test]
    fn preview_classifies_png_signature() {
        let f = classify_bytes("a.bin", b"\x89PNG\r\n\x1a\nrest").unwrap();
        assert_eq!(f.preview_type, PreviewType::Image);
        assert_eq!(f.media_type, "image/png");
    }

    #[test]
    fn preview_classifies_jpeg_signature() {
        let f = classify_bytes("a.bin", b"\xff\xd8\xff\xe0rest").unwrap();
        assert_eq!(f.media_type, "image/jpeg");
    }

    #[test]
    fn preview_classifies_gif_signature() {
        let f = classify_bytes("a.bin", b"GIF89arest").unwrap();
        assert_eq!(f.media_type, "image/gif");
    }

    #[test]
    fn preview_classifies_webp_signature() {
        let f = classify_bytes("a.bin", b"RIFFxxxxWEBPrest").unwrap();
        assert_eq!(f.media_type, "image/webp");
    }

    #[test]
    fn preview_classifies_bmp_signature() {
        let f = classify_bytes("a.bin", b"BMrest").unwrap();
        assert_eq!(f.media_type, "image/bmp");
    }

    #[test]
    fn preview_classifies_pdf_signature() {
        let f = classify_bytes("a.bin", b"%PDF-1.7").unwrap();
        assert_eq!(f.preview_type, PreviewType::Pdf);
        assert_eq!(f.media_type, "application/pdf");
    }

    #[test]
    fn preview_classifies_svg_extension_fallback() {
        let f = classify_bytes("icon.svg", b"<svg").unwrap();
        assert_eq!(f.preview_type, PreviewType::Image);
        assert_eq!(f.media_type, "image/svg+xml");
    }

    #[test]
    fn preview_unsupported_binary_fallback() {
        assert!(classify_bytes("a.bin", b"\x00\x01\x02").is_none());
    }

    #[test]
    fn preview_too_large_reports_limit() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("huge.svg");
        let file = std::fs::File::create(&f).unwrap();
        file.set_len(MAX_PREVIEW_BYTES + 1).unwrap();
        match fs_read_preview_file(f.to_string_lossy().into_owned(), None).unwrap() {
            PreviewReadResult::TooLarge {
                size,
                limit,
                preview_type,
                media_type,
            } => {
                assert_eq!(size, MAX_PREVIEW_BYTES + 1);
                assert_eq!(limit, MAX_PREVIEW_BYTES);
                assert_eq!(preview_type, Some(PreviewType::Image));
                assert_eq!(media_type.as_deref(), Some("image/svg+xml"));
            }
            _ => panic!("expected toolarge"),
        }
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terax.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
