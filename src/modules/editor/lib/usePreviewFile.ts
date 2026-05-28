import { useCallback, useEffect, useState } from "react";
import { readPreviewFile, type PreviewReadResult } from "./mediaPreview";

export type PreviewFileState =
  | { status: "loading" }
  | { status: "ready"; result: PreviewReadResult }
  | { status: "error"; message: string };

export function usePreviewFile(path: string) {
  const [state, setState] = useState<PreviewFileState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    readPreviewFile(path)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", result });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const reload = useCallback((): boolean => {
    void readPreviewFile(path)
      .then((result) => setState({ status: "ready", result }))
      .catch((e) => setState({ status: "error", message: String(e) }));
    return true;
  }, [path]);

  return { state, reload };
}
