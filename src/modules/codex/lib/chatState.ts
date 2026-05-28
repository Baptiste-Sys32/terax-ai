import type {
  CodexEvent,
  CodexPermissionMode,
  CodexReasoningEffort,
  CodexUserInput,
} from "@/modules/codex";

export type CodexThreadItem =
  | {
      type: "userMessage";
      id: string;
      content: CodexUserInput[];
    }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase?: string | null;
      memoryCitation?: unknown;
    }
  | {
      type: "plan";
      id: string;
      text: string;
    }
  | {
      type: "reasoning";
      id: string;
      summary: string[];
      content: string[];
    }
  | {
      type: "commandExecution";
      id: string;
      command?: string | null;
      cwd?: string | null;
      status?: string;
      aggregatedOutput?: string | null;
      exitCode?: number | null;
      durationMs?: number | null;
      [key: string]: unknown;
    }
  | {
      type: "fileChange";
      id: string;
      changes: Array<{ path: string; kind?: string; diff?: string }>;
      status?: string;
      [key: string]: unknown;
    }
  | {
      type: "generic";
      id: string;
      itemType: string;
      [key: string]: unknown;
    };

export type CodexRunStatus = "idle" | "running" | "error";

export type CodexPendingRequest = {
  requestId: string | number;
  method: string;
  params: Record<string, unknown>;
};

export type CodexChatState = {
  threadId: string | null;
  turnId: string | null;
  cwd: string | null;
  status: CodexRunStatus;
  items: CodexThreadItem[];
  pendingRequests: CodexPendingRequest[];
  error: string | null;
  warning: string | null;
};

export type CodexPermissionPreset = {
  label: string;
  description: string;
  approvalPolicy: "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
};

export const CODEX_PERMISSION_PRESETS: Record<
  CodexPermissionMode,
  CodexPermissionPreset
> = {
  default: {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  },
  "read-only": {
    label: "Read only",
    description: "Inspect files without making changes.",
    approvalPolicy: "on-request",
    sandbox: "read-only",
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  },
};

export const REASONING_LABELS: Record<CodexReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

export function createInitialCodexChatState(): CodexChatState {
  return {
    threadId: null,
    turnId: null,
    cwd: null,
    status: "idle",
    items: [],
    pendingRequests: [],
    error: null,
    warning: null,
  };
}

export function reduceCodexEvent(
  state: CodexChatState,
  event: CodexEvent,
): CodexChatState {
  if (event.kind === "serverRequest" && event.id !== undefined && event.id !== null) {
    const params = asRecord(event.params);
    if (!isActionableServerRequest(event.method)) return state;
    if (state.pendingRequests.some((r) => r.requestId === event.id)) return state;
    return {
      ...state,
      pendingRequests: [
        ...state.pendingRequests,
        { requestId: event.id, method: event.method, params },
      ],
    };
  }

  const params = asRecord(event.params);
  switch (event.method) {
    case "thread/started": {
      const thread = asRecord(params.thread);
      const threadId = stringValue(thread.id) ?? state.threadId;
      return {
        ...state,
        threadId,
        cwd: stringValue(thread.cwd) ?? state.cwd,
        items: mergeTurns(state.items, thread.turns),
      };
    }
    case "thread/status/changed": {
      const status = asRecord(params.status);
      return {
        ...state,
        status: status.type === "active" ? "running" : "idle",
      };
    }
    case "turn/started": {
      const turn = asRecord(params.turn);
      return {
        ...state,
        turnId: stringValue(turn.id) ?? state.turnId,
        status: "running",
        error: null,
        items: mergeThreadItems(state.items, itemArray(turn.items)),
      };
    }
    case "turn/completed": {
      const turn = asRecord(params.turn);
      const failed = turn.status === "failed";
      return {
        ...state,
        turnId: null,
        status: failed ? "error" : "idle",
        error: failed ? turnErrorMessage(turn.error) : state.error,
        items: mergeThreadItems(state.items, itemArray(turn.items)),
      };
    }
    case "item/started":
    case "item/completed":
      return {
        ...state,
        items: mergeThreadItems(state.items, itemArray([params.item])),
      };
    case "item/agentMessage/delta":
      return {
        ...state,
        items: updateItem(state.items, stringValue(params.itemId), (item, id) => {
          const existing: Extract<CodexThreadItem, { type: "agentMessage" }> =
            item?.type === "agentMessage"
              ? item
              : { type: "agentMessage", id, text: "" };
          return {
            ...existing,
            text: `${String(existing.text ?? "")}${String(params.delta ?? "")}`,
          };
        }),
      };
    case "item/plan/delta":
      return {
        ...state,
        items: updateItem(state.items, stringValue(params.itemId), (item, id) => {
          const existing: Extract<CodexThreadItem, { type: "plan" }> =
            item?.type === "plan" ? item : { type: "plan", id, text: "" };
          return {
            ...existing,
            text: `${String(existing.text ?? "")}${String(params.delta ?? "")}`,
          };
        }),
      };
    case "item/reasoning/summaryPartAdded":
      return {
        ...state,
        items: updateReasoningItem(
          state.items,
          stringValue(params.itemId),
          (item) => {
            const summary = [...item.summary];
            ensureIndex(summary, numberValue(params.summaryIndex));
            return { ...item, summary };
          },
        ),
      };
    case "item/reasoning/summaryTextDelta":
      return {
        ...state,
        items: updateReasoningItem(
          state.items,
          stringValue(params.itemId),
          (item) => {
            const index = numberValue(params.summaryIndex);
            const summary = [...item.summary];
            ensureIndex(summary, index);
            summary[index] = `${summary[index] ?? ""}${String(params.delta ?? "")}`;
            return { ...item, summary };
          },
        ),
      };
    case "item/reasoning/textDelta":
      return {
        ...state,
        items: updateReasoningItem(
          state.items,
          stringValue(params.itemId),
          (item) => {
            const index = numberValue(params.contentIndex);
            const content = [...item.content];
            ensureIndex(content, index);
            content[index] = `${content[index] ?? ""}${String(params.delta ?? "")}`;
            return { ...item, content };
          },
        ),
      };
    case "item/commandExecution/outputDelta":
    case "command/exec/outputDelta":
    case "process/outputDelta":
      return {
        ...state,
        items: updateItem(state.items, stringValue(params.itemId), (item, id) => {
          const existing: Extract<
            CodexThreadItem,
            { type: "commandExecution" }
          > =
            item?.type === "commandExecution"
              ? item
              : { type: "commandExecution", id, aggregatedOutput: "" };
          return {
            ...existing,
            aggregatedOutput: `${String(existing.aggregatedOutput ?? "")}${String(
              params.delta ?? "",
            )}`,
          };
        }),
      };
    case "item/fileChange/patchUpdated":
      return {
        ...state,
        items: updateItem(state.items, stringValue(params.itemId), (item, id) => ({
          ...(item?.type === "fileChange" ? item : { type: "fileChange", id, status: "inProgress" }),
          changes: changeArray(params.changes),
        })),
      };
    case "serverRequest/resolved":
      return {
        ...state,
        pendingRequests: state.pendingRequests.filter(
          (r) => r.requestId !== params.requestId,
        ),
      };
    case "error":
      return { ...state, status: "error", error: messageFromParams(params) };
    case "warning":
    case "guardianWarning":
    case "configWarning":
    case "deprecationNotice":
      return { ...state, warning: messageFromParams(params) };
    default:
      return state;
  }
}

export function mergeThreadItems(
  items: CodexThreadItem[],
  incoming: CodexThreadItem[],
): CodexThreadItem[] {
  if (incoming.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const order = items.map((item) => item.id);
  for (const item of incoming) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item });
  }
  return order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function codexEventThreadId(event: CodexEvent): string | null {
  const params = asRecord(event.params);
  const direct = stringValue(params.threadId);
  if (direct) return direct;
  const thread = asRecord(params.thread);
  return stringValue(thread.id);
}

export function codexApprovalResult(
  request: Pick<CodexPendingRequest, "method" | "params">,
  action: "accept" | "acceptForSession" | "decline" | "cancel" | "allowTurn" | "allowSession",
): Record<string, unknown> {
  if (request.method === "item/permissions/requestApproval") {
    const permissions = asRecord(request.params.permissions);
    if (action === "allowTurn" || action === "accept") {
      return { permissions, scope: "turn" };
    }
    if (action === "allowSession" || action === "acceptForSession") {
      return { permissions, scope: "session" };
    }
    return { permissions: {}, scope: "turn", strictAutoReview: true };
  }
  const decision =
    action === "allowTurn"
      ? "accept"
      : action === "allowSession"
        ? "acceptForSession"
        : action;
  return { decision };
}

function isActionableServerRequest(method: string): boolean {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "item/tool/requestUserInput"
  );
}

function updateReasoningItem(
  items: CodexThreadItem[],
  id: string | null,
  updater: (
    item: Extract<CodexThreadItem, { type: "reasoning" }>,
  ) => CodexThreadItem,
): CodexThreadItem[] {
  return updateItem(items, id, (item, resolvedId) => {
    const existing =
      item?.type === "reasoning"
        ? item
        : { type: "reasoning", id: resolvedId, summary: [], content: [] };
    return updater(existing as Extract<CodexThreadItem, { type: "reasoning" }>);
  });
}

function updateItem(
  items: CodexThreadItem[],
  id: string | null,
  updater: (item: CodexThreadItem | null, id: string) => CodexThreadItem,
): CodexThreadItem[] {
  if (!id) return items;
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return [...items, updater(null, id)];
  const next = [...items];
  next[idx] = updater(next[idx] ?? null, id);
  return next;
}

function mergeTurns(items: CodexThreadItem[], turns: unknown): CodexThreadItem[] {
  if (!Array.isArray(turns)) return items;
  return turns.reduce(
    (acc, turn) => mergeThreadItems(acc, itemArray(asRecord(turn).items)),
    items,
  );
}

function itemArray(value: unknown): CodexThreadItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = stringValue(record.id);
    const type = stringValue(record.type);
    if (!id || !type) return [];
    const base = {
      ...record,
      id,
      type: isKnownItemType(type) ? type : "generic",
      ...(!isKnownItemType(type) && { itemType: type }),
    };
    return [normalizeItem(base as CodexThreadItem)];
  });
}

function normalizeItem(item: CodexThreadItem): CodexThreadItem {
  switch (item.type) {
    case "userMessage":
      return {
        ...item,
        content: Array.isArray(item.content) ? item.content : [],
      };
    case "agentMessage":
      return {
        ...item,
        text: typeof item.text === "string" ? item.text : "",
      };
    case "plan":
      return {
        ...item,
        text: typeof item.text === "string" ? item.text : "",
      };
    case "reasoning":
      return {
        ...item,
        summary: stringArray(item.summary),
        content: stringArray(item.content),
      };
    case "commandExecution":
      return {
        ...item,
        command: optionalString(item.command),
        cwd: optionalString(item.cwd),
        status: optionalString(item.status) ?? undefined,
        aggregatedOutput: optionalString(item.aggregatedOutput),
        exitCode: numberOrNull(item.exitCode),
        durationMs: numberOrNull(item.durationMs),
      };
    case "fileChange":
      return {
        ...item,
        changes: changeArray(item.changes),
        status: optionalString(item.status) ?? undefined,
      };
    default:
      return item;
  }
}

function isKnownItemType(type: string): type is CodexThreadItem["type"] {
  return (
    type === "userMessage" ||
    type === "agentMessage" ||
    type === "plan" ||
    type === "reasoning" ||
    type === "commandExecution" ||
    type === "fileChange"
  );
}

function changeArray(value: unknown): Array<{ path: string; kind?: string; diff?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((change) => {
    const record = asRecord(change);
    const path = stringValue(record.path);
    if (!path) return [];
    return [
      {
        path,
        ...(typeof record.kind === "string" && { kind: record.kind }),
        ...(typeof record.diff === "string" && { diff: record.diff }),
      },
    ];
  });
}

function ensureIndex(values: string[], index: number) {
  while (values.length <= index) values.push("");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : String(item ?? "")))
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function messageFromParams(params: Record<string, unknown>): string {
  return (
    stringValue(params.message) ??
    stringValue(params.detail) ??
    stringValue(params.error) ??
    JSON.stringify(params)
  );
}

function turnErrorMessage(value: unknown): string {
  const record = asRecord(value);
  return messageFromParams(record) || "Codex turn failed.";
}
