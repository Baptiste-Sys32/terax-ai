import type { CodexTabState, Tab } from "@/modules/tabs";
import { useMemo } from "react";
import { CodexChatView, type CodexPaneHandle } from "./CodexChatView";

export function CodexStack({
  tabs,
  activeId,
  registerHandle,
  onStateChange,
}: {
  tabs: Tab[];
  activeId: number;
  registerHandle?: (id: number, handle: CodexPaneHandle | null) => void;
  onStateChange?: (id: number, state: CodexTabState) => void;
}) {
  const codexTabs = useMemo(
    () => tabs.filter((tab) => tab.kind === "codex"),
    [tabs],
  );

  return (
    <div className="relative h-full w-full">
      {codexTabs.map((tab) => {
        const visible = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{
              visibility: visible ? "visible" : "hidden",
              pointerEvents: visible ? "auto" : "none",
            }}
            aria-hidden={!visible}
          >
            <CodexChatView
              ref={(handle) => registerHandle?.(tab.id, handle)}
              tab={tab}
              onStateChange={onStateChange}
            />
          </div>
        );
      })}
    </div>
  );
}
