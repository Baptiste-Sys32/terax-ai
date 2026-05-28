import { describe, expect, it } from "vitest";
import {
  base64ToBlob,
  clampPageNumber,
  clampZoom,
  formatMediaLabel,
  formatPreviewBytes,
  previewIntentForPath,
} from "./mediaPreview";

describe("previewIntentForPath", () => {
  it("routes supported image extensions to image preview", () => {
    expect(previewIntentForPath("/tmp/photo.PNG")).toBe("image");
    expect(previewIntentForPath("/tmp/vector.svg")).toBe("image");
    expect(previewIntentForPath("/tmp/modern.avif")).toBe("image");
  });

  it("routes PDFs to PDF preview", () => {
    expect(previewIntentForPath("/tmp/report.PDF")).toBe("pdf");
  });

  it("leaves normal source files in the editor", () => {
    expect(previewIntentForPath("/tmp/app.tsx")).toBeNull();
    expect(previewIntentForPath("/tmp/readme.md")).toBeNull();
  });
});

describe("base64ToBlob", () => {
  it("preserves media type and bytes", async () => {
    const blob = base64ToBlob("aGVsbG8=", "image/png");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(5);
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe("hello");
  });
});

describe("preview labels", () => {
  it("formats bytes compactly", () => {
    expect(formatPreviewBytes(64)).toBe("64 B");
    expect(formatPreviewBytes(1536)).toBe("1.5 KB");
    expect(formatPreviewBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("formats common media types", () => {
    expect(formatMediaLabel("image/png")).toBe("PNG image");
    expect(formatMediaLabel("application/pdf")).toBe("PDF document");
    expect(formatMediaLabel("application/octet-stream")).toBe(
      "application/octet-stream",
    );
  });
});

describe("preview clamps", () => {
  it("clamps zoom to the allowed range", () => {
    expect(clampZoom(0.1, 0.25, 4)).toBe(0.25);
    expect(clampZoom(2, 0.25, 4)).toBe(2);
    expect(clampZoom(8, 0.25, 4)).toBe(4);
  });

  it("clamps page numbers to the document range", () => {
    expect(clampPageNumber(-1, 12)).toBe(1);
    expect(clampPageNumber(4.7, 12)).toBe(4);
    expect(clampPageNumber(99, 12)).toBe(12);
  });
});
