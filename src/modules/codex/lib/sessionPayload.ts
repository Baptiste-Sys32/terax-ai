import type { CodexThreadListItem } from "@/modules/codex";

export type NormalizedCodexSession = {
  id: string;
  title: string;
  preview: string | null;
  cwd: string | null;
  source: string;
  updatedAtMs: number | null;
  raw: unknown;
};

export function normalizeThreadListPayload(
  response: unknown,
): NormalizedCodexSession[] {
  const record = asObject(response);
  const raw = Array.isArray(record.threads)
    ? record.threads
    : Array.isArray(record.data)
      ? record.data
      : [];
  return raw.flatMap((item) => {
    const normalized = normalizeSession(item);
    return normalized ? [normalized] : [];
  });
}

export function normalizeSession(value: unknown): NormalizedCodexSession | null {
  const record = asObject(value);
  const id = stringField(record.id);
  if (!id) return null;

  const preview =
    stringField(record.preview) ??
    stringField(record.summary) ??
    stringField(record.lastMessage);
  const title =
    stringField(record.title) ??
    preview ??
    `Session ${shortThreadId(id)}`;
  const updatedAtMs = timestampMs(
    record.updatedAt ?? record.updated_at ?? record.lastUpdatedAt,
  );

  return {
    id,
    title,
    preview,
    cwd: stringField(record.cwd) ?? stringField(record.workingDirectory),
    source:
      stringField(record.source) ??
      stringField(record.threadSource) ??
      stringField(record.sessionSource) ??
      "Codex",
    updatedAtMs,
    raw: value,
  };
}

export function denormalizeSessionForCompatibility(
  session: NormalizedCodexSession,
): CodexThreadListItem {
  return {
    ...(asObject(session.raw) as CodexThreadListItem),
    id: session.id,
    title: session.title,
    preview: session.preview,
    cwd: session.cwd,
    source: session.source,
    updatedAt: session.updatedAtMs,
  };
}

export function formatSessionUpdatedMs(value: number | null): string {
  if (value === null) return "Updated unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortThreadId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || value.length === 0) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return timestampMs(numeric);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
