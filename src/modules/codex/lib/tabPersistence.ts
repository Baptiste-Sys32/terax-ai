import type { CodexTab, CodexTabState } from "@/modules/tabs";
import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "terax-codex-tabs.json";
const KEY_TABS = "tabs";
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type PersistedCodexTab = {
  title: string;
  cwd: string | null;
  codex: CodexTabState;
};

export async function loadPersistedCodexTabs(): Promise<PersistedCodexTab[]> {
  const value = await store.get<unknown>(KEY_TABS);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const tab = normalizePersistedCodexTab(item);
    return tab ? [tab] : [];
  });
}

export async function savePersistedCodexTabs(tabs: CodexTab[]): Promise<void> {
  const payload: PersistedCodexTab[] = tabs.flatMap((tab) => {
    const codex = tab.codex;
    if (!codex?.uid) return [];
    return [
      {
        title: tab.title || "Codex",
        cwd: tab.cwd ?? codex.cwd ?? null,
        codex,
      },
    ];
  });
  await store.set(KEY_TABS, payload);
  await store.save();
}

function normalizePersistedCodexTab(value: unknown): PersistedCodexTab | null {
  const record = asObject(value);
  const codex = normalizeCodexTabState(record.codex);
  if (!codex) return null;
  return {
    title: stringValue(record.title) ?? "Codex",
    cwd: stringValue(record.cwd) ?? codex.cwd,
    codex,
  };
}

function normalizeCodexTabState(value: unknown): CodexTabState | null {
  const record = asObject(value);
  const uid = stringValue(record.uid);
  if (!uid) return null;
  return {
    uid,
    threadId: stringValue(record.threadId),
    cwd: stringValue(record.cwd),
    selectedModel: stringValue(record.selectedModel) ?? "",
    effort: isEffort(record.effort) ? record.effort : "low",
    permissionMode: isPermissionMode(record.permissionMode)
      ? record.permissionMode
      : "default",
    updatedAt: numberValue(record.updatedAt) ?? Date.now(),
  };
}

function isEffort(value: unknown): value is CodexTabState["effort"] {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function isPermissionMode(
  value: unknown,
): value is CodexTabState["permissionMode"] {
  return (
    value === "default" ||
    value === "read-only" ||
    value === "full-access"
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
