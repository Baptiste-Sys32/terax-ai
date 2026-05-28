import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

export type PreviewType = "image" | "pdf";

export type PreviewReadResult =
  | {
      kind: "preview";
      previewType: PreviewType;
      mediaType: string;
      size: number;
      fileName: string;
      dataBase64: string;
    }
  | {
      kind: "unsupported";
      size: number;
      reason: string;
    }
  | {
      kind: "toolarge";
      size: number;
      limit: number;
      previewType?: PreviewType;
      mediaType?: string;
    };

const PREVIEW_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "svgz",
  "bmp",
  "avif",
  "pdf",
]);

export function previewIntentForPath(path: string): PreviewType | null {
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  if (!ext || !PREVIEW_EXTENSIONS.has(ext)) return null;
  return ext === "pdf" ? "pdf" : "image";
}

export async function readPreviewFile(
  path: string,
): Promise<PreviewReadResult> {
  return invoke<PreviewReadResult>("fs_read_preview_file", {
    path,
    workspace: currentWorkspaceEnv(),
  });
}

export function formatPreviewBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMediaLabel(mediaType?: string): string {
  if (!mediaType) return "Unknown";
  const labels: Record<string, string> = {
    "image/png": "PNG image",
    "image/jpeg": "JPEG image",
    "image/gif": "GIF image",
    "image/webp": "WebP image",
    "image/svg+xml": "SVG image",
    "image/bmp": "BMP image",
    "image/avif": "AVIF image",
    "application/pdf": "PDF document",
  };
  return labels[mediaType] ?? mediaType;
}

export function clampZoom(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampPageNumber(value: number, pageCount: number): number {
  if (!Number.isFinite(value) || pageCount < 1) return 1;
  return Math.min(pageCount, Math.max(1, Math.trunc(value)));
}

export function base64ToUint8Array(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64ToBlob(dataBase64: string, mediaType: string): Blob {
  return new Blob([base64ToUint8Array(dataBase64)], { type: mediaType });
}

export function createPreviewBlobUrl(
  dataBase64: string,
  mediaType: string,
): string {
  return URL.createObjectURL(base64ToBlob(dataBase64, mediaType));
}
