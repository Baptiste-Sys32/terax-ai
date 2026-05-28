import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  FileCorruptIcon,
  FitToScreenIcon,
  FolderOpenIcon,
  ImageActualSizeIcon,
  MinusSignIcon,
  PlusSignIcon,
  RefreshIcon,
  ScrollVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { copyToClipboard, revealInFinder } from "@/modules/explorer/lib/contextActions";
import { useEffect, useRef, useState } from "react";
import {
  base64ToUint8Array,
  clampPageNumber,
  clampZoom,
  createPreviewBlobUrl,
  formatMediaLabel,
  formatPreviewBytes,
  type PreviewReadResult,
} from "./lib/mediaPreview";

type Props = {
  path: string;
  result: PreviewReadResult;
  onReload: () => void;
};

type PreviewFile = Extract<PreviewReadResult, { kind: "preview" }>;

const IMAGE_MIN_ZOOM = 0.25;
const IMAGE_MAX_ZOOM = 4;
const PDF_MIN_ZOOM = 0.5;
const PDF_MAX_ZOOM = 3;
type PdfViewMode = "page" | "scroll";

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}

function PreviewToolbar({
  fileName,
  mediaType,
  size,
  children,
}: {
  fileName: string;
  mediaType?: string;
  size: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/20 px-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">
          {fileName}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {formatMediaLabel(mediaType)} · {formatPreviewBytes(size)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function PreviewFallback({
  title,
  detail,
  tone = "muted",
}: {
  title: string;
  detail: string;
  tone?: "muted" | "error";
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <HugeiconsIcon
        icon={FileCorruptIcon}
        size={20}
        strokeWidth={1.8}
        className={tone === "error" ? "text-destructive" : "text-muted-foreground"}
      />
      <div className="text-sm text-foreground">{title}</div>
      <div
        className={
          tone === "error"
            ? "max-w-md text-xs text-destructive"
            : "max-w-md text-xs text-muted-foreground"
        }
      >
        {detail}
      </div>
    </div>
  );
}

function ImagePreviewPane({
  path,
  file,
  onReload,
}: {
  path: string;
  file: PreviewFile;
  onReload: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [decodeError, setDecodeError] = useState(false);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    setDecodeError(false);
    setNaturalSize(null);
    const nextUrl = createPreviewBlobUrl(file.dataBase64, file.mediaType);
    setBlobUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file.dataBase64, file.mediaType]);

  const setActualSize = () => {
    setFit(false);
    setZoom(1);
  };
  const updateZoom = (delta: number) => {
    setFit(false);
    setZoom((z) => clampZoom(z + delta, IMAGE_MIN_ZOOM, IMAGE_MAX_ZOOM));
  };
  const reset = () => {
    setFit(true);
    setZoom(1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewToolbar fileName={file.fileName} mediaType={file.mediaType} size={file.size}>
        <IconButton label="Fit to container" onClick={() => setFit(true)} aria-pressed={fit}>
          <HugeiconsIcon icon={FitToScreenIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Actual size" onClick={setActualSize} aria-pressed={!fit && zoom === 1}>
          <HugeiconsIcon icon={ImageActualSizeIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => updateZoom(-0.25)} disabled={!fit && zoom <= IMAGE_MIN_ZOOM}>
          <HugeiconsIcon icon={MinusSignIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <div className="w-11 text-center text-[11px] tabular-nums text-muted-foreground">
          {fit ? "Fit" : `${Math.round(zoom * 100)}%`}
        </div>
        <IconButton label="Zoom in" onClick={() => updateZoom(0.25)} disabled={!fit && zoom >= IMAGE_MAX_ZOOM}>
          <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Reset zoom" onClick={reset}>
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Copy path" onClick={() => void copyToClipboard(path)}>
          <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Reveal in file manager" onClick={() => void revealInFinder(path)}>
          <HugeiconsIcon icon={FolderOpenIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Reload" onClick={onReload}>
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.8} />
        </IconButton>
      </PreviewToolbar>
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <div className="flex min-h-full min-w-full items-center justify-center p-4">
          {decodeError ? (
            <PreviewFallback
              title="Image preview failed"
              detail={`${file.fileName} could not be decoded by this WebView. ${formatPreviewBytes(file.size)} · ${formatMediaLabel(file.mediaType)}`}
              tone="error"
            />
          ) : blobUrl ? (
            <img
              src={blobUrl}
              alt={file.fileName}
              draggable={false}
              className={fit ? "max-h-full max-w-full object-contain" : "max-w-none"}
              style={
                fit
                  ? undefined
                  : naturalSize
                    ? {
                        width: `${naturalSize.width * zoom}px`,
                        height: `${naturalSize.height * zoom}px`,
                      }
                    : { transform: `scale(${zoom})` }
              }
              onLoad={(event) => {
                const img = event.currentTarget;
                setNaturalSize({
                  width: img.naturalWidth || img.width,
                  height: img.naturalHeight || img.height,
                });
              }}
              onError={() => setDecodeError(true)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PdfPreviewPane({
  path,
  file,
  onReload,
}: {
  path: string;
  file: PreviewFile;
  onReload: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageHostRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [viewMode, setViewMode] = useState<PdfViewMode>("page");
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [hostWidth, setHostWidth] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    const node = pageHostRef.current;
    if (!node) return;
    const update = () => setHostWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;
    let loadedDoc: any = null;
    setDoc(null);
    setPageCount(0);
    setPageNumber(1);
    setPageDraft("1");
    setRenderError(null);

    void import("pdfjs-dist")
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        loadingTask = pdfjs.getDocument({ data: base64ToUint8Array(file.dataBase64) });
        return loadingTask.promise;
      })
      .then((nextDoc) => {
        loadedDoc = nextDoc;
        if (cancelled) {
          void nextDoc.destroy();
          return;
        }
        setDoc(nextDoc);
        setPageCount(nextDoc.numPages);
      })
      .catch((e) => {
        if (!cancelled) {
          setRenderError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
      void loadedDoc?.destroy?.();
    };
  }, [file.dataBase64]);

  useEffect(() => {
    setPageDraft(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (viewMode !== "page" || !doc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setRendering(true);
    setRenderError(null);

    void doc
      .getPage(pageNumber)
      .then((page: any) => {
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale =
          hostWidth > 0
            ? clampZoom((hostWidth - 32) / baseViewport.width, PDF_MIN_ZOOM, PDF_MAX_ZOOM)
            : 1;
        const scale = fitWidth ? fitScale : zoom;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering context is unavailable.");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const nextRenderTask = page.render({ canvasContext: context, viewport });
        renderTask = nextRenderTask;
        return nextRenderTask.promise;
      })
      .catch((e: any) => {
        if (cancelled || e?.name === "RenderingCancelledException") return;
        setRenderError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, zoom, fitWidth, hostWidth, viewMode]);

  const goToPage = (next: number) => {
    const clamped = clampPageNumber(next, pageCount);
    setPageNumber(clamped);
    setPageDraft(String(clamped));
  };
  const updateZoom = (delta: number) => {
    setFitWidth(false);
    setZoom((z) => clampZoom(z + delta, PDF_MIN_ZOOM, PDF_MAX_ZOOM));
  };
  const reset = () => {
    setFitWidth(true);
    setZoom(1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewToolbar fileName={file.fileName} mediaType={file.mediaType} size={file.size}>
        <IconButton
          label={viewMode === "scroll" ? "Show one page" : "Scroll pages vertically"}
          onClick={() =>
            setViewMode((mode) => (mode === "scroll" ? "page" : "scroll"))
          }
          aria-pressed={viewMode === "scroll"}
        >
          <HugeiconsIcon icon={ScrollVerticalIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          label="Previous page"
          onClick={() => goToPage(pageNumber - 1)}
          disabled={viewMode === "scroll" || pageNumber <= 1}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={1.8} />
        </IconButton>
        <input
          value={pageDraft}
          inputMode="numeric"
          aria-label="Page number"
          disabled={viewMode === "scroll"}
          className="h-6 w-10 rounded border border-border/70 bg-background px-1 text-center text-xs tabular-nums outline-none focus:border-ring"
          onChange={(event) => setPageDraft(event.currentTarget.value)}
          onBlur={() => goToPage(Number(pageDraft))}
          onKeyDown={(event) => {
            if (event.key === "Enter") goToPage(Number(pageDraft));
          }}
        />
        <div className="w-10 text-[11px] tabular-nums text-muted-foreground">
          / {pageCount || "?"}
        </div>
        <IconButton
          label="Next page"
          onClick={() => goToPage(pageNumber + 1)}
          disabled={
            viewMode === "scroll" || pageCount < 1 || pageNumber >= pageCount
          }
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => updateZoom(-0.25)} disabled={!fitWidth && zoom <= PDF_MIN_ZOOM}>
          <HugeiconsIcon icon={MinusSignIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <div className="w-11 text-center text-[11px] tabular-nums text-muted-foreground">
          {fitWidth ? "Width" : `${Math.round(zoom * 100)}%`}
        </div>
        <IconButton label="Zoom in" onClick={() => updateZoom(0.25)} disabled={!fitWidth && zoom >= PDF_MAX_ZOOM}>
          <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Fit width" onClick={() => setFitWidth(true)} aria-pressed={fitWidth}>
          <HugeiconsIcon icon={FitToScreenIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Reset zoom" onClick={reset}>
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Copy path" onClick={() => void copyToClipboard(path)}>
          <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Reveal in file manager" onClick={() => void revealInFinder(path)}>
          <HugeiconsIcon icon={FolderOpenIcon} size={13} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Reload" onClick={onReload}>
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.8} />
        </IconButton>
      </PreviewToolbar>
      <div ref={pageHostRef} className="min-h-0 flex-1 overflow-auto bg-muted/10">
        <div
          className={
            viewMode === "scroll"
              ? "flex min-h-full min-w-full flex-col items-center gap-4 p-4"
              : "flex min-h-full min-w-full items-start justify-center p-4"
          }
        >
          {renderError ? (
            <PreviewFallback
              title="PDF preview failed"
              detail={`${file.fileName} could not be rendered. ${formatPreviewBytes(file.size)} · ${renderError}`}
              tone="error"
            />
          ) : viewMode === "scroll" && doc && pageCount > 0 ? (
            Array.from({ length: pageCount }, (_, index) => (
              <PdfScrollPage
                key={index + 1}
                doc={doc}
                pageNumber={index + 1}
                hostWidth={hostWidth}
                fitWidth={fitWidth}
                zoom={zoom}
                onRenderError={(message) => setRenderError(message)}
              />
            ))
          ) : (
            <div className="relative">
              {rendering ? (
                <div className="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
                  Rendering…
                </div>
              ) : null}
              <canvas
                ref={canvasRef}
                className="block bg-white shadow-sm ring-1 ring-border/70"
                aria-label={`${file.fileName} page ${pageNumber}`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PdfScrollPage({
  doc,
  pageNumber,
  hostWidth,
  fitWidth,
  zoom,
  onRenderError,
}: {
  doc: any;
  pageNumber: number;
  hostWidth: number;
  fitWidth: boolean;
  zoom: number;
  onRenderError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setRendering(true);

    void doc
      .getPage(pageNumber)
      .then((page: any) => {
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale =
          hostWidth > 0
            ? clampZoom((hostWidth - 32) / baseViewport.width, PDF_MIN_ZOOM, PDF_MAX_ZOOM)
            : 1;
        const scale = fitWidth ? fitScale : zoom;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering context is unavailable.");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const nextRenderTask = page.render({ canvasContext: context, viewport });
        renderTask = nextRenderTask;
        return nextRenderTask.promise;
      })
      .catch((e: any) => {
        if (cancelled || e?.name === "RenderingCancelledException") return;
        onRenderError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, hostWidth, fitWidth, zoom, onRenderError]);

  return (
    <div className="relative">
      <div className="mb-1 text-center text-[11px] tabular-nums text-muted-foreground">
        {pageNumber}
      </div>
      {rendering ? (
        <div className="absolute left-2 top-7 rounded bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
          Rendering…
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        className="block bg-white shadow-sm ring-1 ring-border/70"
        aria-label={`Page ${pageNumber}`}
      />
    </div>
  );
}

export function MediaPreviewPane({ path, result, onReload }: Props) {
  if (result.kind === "unsupported") {
    return (
      <PreviewFallback
        title="Binary file"
        detail={`${formatPreviewBytes(result.size)} · ${result.reason}`}
      />
    );
  }

  if (result.kind === "toolarge") {
    return (
      <PreviewFallback
        title="File too large"
        detail={`${formatMediaLabel(result.mediaType)} · ${formatPreviewBytes(result.size)} exceeds the ${formatPreviewBytes(result.limit)} preview limit.`}
      />
    );
  }

  if (result.previewType === "pdf") {
    return <PdfPreviewPane path={path} file={result} onReload={onReload} />;
  }

  if (result.previewType === "image") {
    return <ImagePreviewPane path={path} file={result} onReload={onReload} />;
  }

  return (
    <PreviewFallback
      title="Preview not supported"
      detail={`${fileNameFromPath(path)} cannot be previewed.`}
    />
  );
}
