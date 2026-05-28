import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "MediaPreviewPane.tsx"), "utf8");

describe("MediaPreviewPane PDF.js worker wiring", () => {
  it("loads the PDF.js worker through Vite asset URLs", () => {
    expect(src).toMatch(
      /pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/,
    );
  });

  it("configures GlobalWorkerOptions.workerSrc", () => {
    expect(src).toMatch(/GlobalWorkerOptions\.workerSrc\s*=\s*workerUrl/);
  });

  it("does not use iframe, object, or embed PDF rendering", () => {
    expect(src).not.toMatch(/<iframe\b|<object\b|<embed\b/);
  });

  it("includes a vertical scroll PDF view mode", () => {
    expect(src).toMatch(/PdfViewMode = "page" \| "scroll"/);
    expect(src).toMatch(/Scroll pages vertically/);
    expect(src).toMatch(/<PdfScrollPage/);
  });
});
