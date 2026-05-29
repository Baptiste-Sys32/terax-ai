import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";

type ReadResult =
  | { kind: "text"; content: string; size: number; encoding?: TextEncoding }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type TextEncoding = "utf8" | "utf8-bom" | "utf16-le" | "utf16-be";

type TextWindowResult = {
  content: string;
  offset: number;
  nextOffset: number;
  size: number;
  encoding: TextEncoding;
  eof: boolean;
};

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number; encoding?: TextEncoding }
  | {
      status: "large";
      content: string;
      size: number;
      limit: number;
      offset: number;
      nextOffset: number;
      encoding: TextEncoding;
      eof: boolean;
      loadingMore: boolean;
    }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (doc.status === "large") return;
    const content = bufferRef.current;
    await invoke("fs_write_file", {
      path,
      content,
      workspace: currentWorkspaceEnv(),
      source: "editor",
    });
    savedRef.current = content;
    setDirty(false);
  }, [doc.status, path]);

  const openLargeWindow = useCallback(
    async (size: number, limit: number) => {
      const res = await invoke<TextWindowResult>("fs_read_text_window", {
        path,
        offset: 0,
        workspace: currentWorkspaceEnv(),
      });
      savedRef.current = res.content;
      bufferRef.current = res.content;
      setDirty(false);
      setDoc({
        status: "large",
        content: res.content,
        size,
        limit,
        offset: res.offset,
        nextOffset: res.nextOffset,
        encoding: res.encoding,
        eof: res.eof,
        loadingMore: false,
      });
    },
    [path],
  );

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  // Load on path change or explicit reload.
  useEffect(() => {
    let cancelled = false;
    setDoc({ status: "loading" });
    setDirty(false);

    invoke<ReadResult>("fs_read_file", { path, workspace: currentWorkspaceEnv() })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setDoc({
            status: "ready",
            content: res.content,
            size: res.size,
            encoding: res.encoding,
          });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          void openLargeWindow(res.size, res.limit).catch((e) => {
            if (!cancelled) {
              setDoc({ status: "toolarge", size: res.size, limit: res.limit });
              console.error("[large-file]", e);
            }
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [path, openLargeWindow]);

  // Skipped while dirty (never clobber unsaved edits) and when disk already
  // matches the buffer (self-save / duplicate watcher event → no re-render).
  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    void invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (res.kind === "text") {
          if (res.content === savedRef.current) return;
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setDirty(false);
          setDoc({
            status: "ready",
            content: res.content,
            size: res.size,
            encoding: res.encoding,
          });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          void openLargeWindow(res.size, res.limit).catch(() =>
            setDoc({ status: "toolarge", size: res.size, limit: res.limit }),
          );
        }
      })
      .catch((e) => setDoc({ status: "error", message: String(e) }));
    return true;
  }, [path, openLargeWindow]);

  const save = useCallback(async () => {
    clearAutoSaveTimer();
    if (doc.status === "large") return;
    if (!dirty) return;
    await saveNow();
  }, [doc.status, dirty, clearAutoSaveTimer, saveNow]);

  const onChange = useCallback(
    (next: string) => {
      if (doc.status === "large") return;
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      setDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => console.error("[autosave]", e));
        }, delay);
      }
    },
    [doc.status, clearAutoSaveTimer, saveNow],
  );

  const loadMore = useCallback(async () => {
    const current = doc;
    if (current.status !== "large" || current.eof || current.loadingMore) return;
    setDoc({ ...current, loadingMore: true });
    try {
      const res = await invoke<TextWindowResult>("fs_read_text_window", {
        path,
        offset: current.nextOffset,
        workspace: currentWorkspaceEnv(),
      });
      const content = current.content + res.content;
      savedRef.current = content;
      bufferRef.current = content;
      setDoc({
        ...current,
        content,
        nextOffset: res.nextOffset,
        eof: res.eof,
        loadingMore: false,
      });
    } catch (e) {
      setDoc({ ...current, loadingMore: false });
      console.error("[large-file]", e);
    }
  }, [doc, path]);

  useEffect(() => clearAutoSaveTimer, [path, clearAutoSaveTimer]);

  return { doc, dirty, onChange, save, reload, loadMore };
}
