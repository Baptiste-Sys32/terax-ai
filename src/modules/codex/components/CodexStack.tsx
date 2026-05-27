import type { Tab } from "@/modules/tabs";
import { useMemo } from "react";
import { CodexChatView } from "./CodexChatView";

export function CodexStack({
  tabs,
  activeId,
}: {
  tabs: Tab[];
  activeId: number;
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
            <CodexChatView tab={tab} />
          </div>
        );
      })}
    </div>
  );
}
