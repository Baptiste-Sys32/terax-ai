import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type CodexAccount =
  | { type: "chatgpt"; email: string; planType: string }
  | { type: "apiKey" }
  | { type: "amazonBedrock" }
  | Record<string, unknown>;

export type CodexStatus = {
  installed: boolean;
  version?: string | null;
  account?: CodexAccount | null;
  accounts?: CodexAccountProfile[];
  activeAccountId?: string;
  requiresOpenaiAuth?: boolean | null;
  detail?: string | null;
};

export type CodexAccountProfile = {
  id: string;
  label: string;
  home: string;
  account?: CodexAccount | null;
  active: boolean;
  managed: boolean;
};

export type CodexDebugStatus = {
  codexHome: string;
  activeAccountId: string;
  activeAccountLabel: string;
  activeAccountHome: string;
  codexBin?: string | null;
  cliVersion?: string | null;
  appServerHealthy: boolean;
  lastBridgeError?: string | null;
};

export type CodexLoginStartResponse =
  | { kind: "browser"; loginId: string; authUrl: string }
  | {
      kind: "device";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    };

export type CodexReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: CodexReasoningEffort;
    description: string;
  }>;
  defaultReasoningEffort: CodexReasoningEffort;
  defaultServiceTier: string | null;
  isDefault: boolean;
};

export type CodexModelListResponse = {
  data: CodexModel[];
  nextCursor: string | null;
};

export type CodexPermissionMode = "default" | "read-only" | "full-access";

export type CodexEvent = {
  kind?: "notification" | "serverRequest";
  id?: string | number | null;
  method: string;
  params: unknown;
};

export type CodexUserInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: "image"; url: string; detail?: "low" | "high" | "auto" }
  | { type: "localImage"; path: string; detail?: "low" | "high" | "auto" }
  | { type: "skill"; [key: string]: unknown }
  | { type: "mention"; [key: string]: unknown };

export type CodexThreadStartResponse = {
  thread: {
    id: string;
    cwd?: string;
    turns?: unknown[];
  };
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  cwd?: string;
  reasoningEffort?: CodexReasoningEffort | null;
};

export type CodexThreadListItem = {
  id: string;
  title?: string | null;
  preview?: string | null;
  cwd?: string | null;
  updatedAt?: string | number | null;
  updated_at?: string | number | null;
  source?: string | null;
  threadSource?: string | null;
  [key: string]: unknown;
};

export type CodexThreadListResponse = {
  threads?: CodexThreadListItem[];
  data?: CodexThreadListItem[];
  nextCursor?: string | null;
  [key: string]: unknown;
};

export type CodexThreadLoadResponse = CodexThreadStartResponse;

export type CodexTurnStartResponse = {
  turn: {
    id: string;
    items?: unknown[];
    status?: string;
  };
};

export function codexStatus(): Promise<CodexStatus> {
  return invoke<CodexStatus>("codex_status");
}

export function codexLoginStart(): Promise<CodexLoginStartResponse> {
  return invoke<CodexLoginStartResponse>("codex_login_start");
}

export function codexLoginCancel(loginId: string): Promise<void> {
  return invoke("codex_login_cancel", { loginId });
}

export function codexLogout(): Promise<void> {
  return invoke("codex_logout");
}

export function codexAccountSwitch(profileId: string): Promise<CodexStatus> {
  return invoke<CodexStatus>("codex_account_switch", { profileId });
}

export function codexAccountCreate(label?: string): Promise<CodexAccountProfile> {
  return invoke<CodexAccountProfile>("codex_account_create", {
    label: label ?? null,
  });
}

export function codexDebugStatus(): Promise<CodexDebugStatus> {
  return invoke<CodexDebugStatus>("codex_debug_status");
}

export function codexAppRequest<T = unknown>(
  method: string,
  params?: unknown,
): Promise<T> {
  return invoke<T>("codex_app_request", { method, params: params ?? null });
}

export function codexAppRespond(
  requestId: string | number,
  result: unknown,
): Promise<void> {
  return invoke("codex_app_respond", { requestId, result });
}

export function codexModelList(): Promise<CodexModelListResponse> {
  return codexAppRequest<CodexModelListResponse>("model/list", {
    includeHidden: false,
  });
}

export function codexThreadStart(input: {
  cwd?: string;
  model?: string;
  approvalPolicy?: unknown;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  sessionStartSource?: "startup" | "clear";
}): Promise<CodexThreadStartResponse> {
  return codexAppRequest<CodexThreadStartResponse>("thread/start", {
    cwd: input.cwd ?? null,
    model: input.model ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    sandbox: input.sandbox ?? null,
    serviceName: "terax",
    threadSource: "user",
    sessionStartSource: input.sessionStartSource ?? null,
  });
}

export function codexThreadList(input: {
  limit?: number;
  sortKey?: "updated_at" | "created_at";
  sortDirection?: "asc" | "desc";
  archived?: boolean;
}): Promise<CodexThreadListResponse> {
  return codexAppRequest<CodexThreadListResponse>("thread/list", input);
}

export function codexThreadResume(input: {
  threadId: string;
  cwd?: string;
  model?: string;
  approvalPolicy?: unknown;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}): Promise<CodexThreadLoadResponse> {
  return codexAppRequest<CodexThreadLoadResponse>("thread/resume", {
    threadId: input.threadId,
    cwd: input.cwd ?? null,
    model: input.model ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    sandbox: input.sandbox ?? null,
  });
}

export function codexThreadFork(input: {
  threadId: string;
  cwd?: string;
  model?: string;
  approvalPolicy?: unknown;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}): Promise<CodexThreadLoadResponse> {
  return codexAppRequest<CodexThreadLoadResponse>("thread/fork", {
    threadId: input.threadId,
    cwd: input.cwd ?? null,
    model: input.model ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    sandbox: input.sandbox ?? null,
  });
}

export function codexTurnStart(input: {
  threadId: string;
  input: CodexUserInput[];
  cwd?: string;
  model?: string;
  effort?: CodexReasoningEffort | null;
  approvalPolicy?: unknown;
}): Promise<CodexTurnStartResponse> {
  return codexAppRequest<CodexTurnStartResponse>("turn/start", {
    threadId: input.threadId,
    input: input.input,
    cwd: input.cwd ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
  });
}

export function codexTurnInterrupt(input: {
  threadId: string;
  turnId: string;
}): Promise<void> {
  return codexAppRequest("turn/interrupt", input);
}

export function codexThreadRead(threadId: string): Promise<unknown> {
  return codexAppRequest("thread/read", { threadId, includeTurns: true });
}

export function listenCodexEvents(
  onEvent: (event: CodexEvent) => void,
): Promise<UnlistenFn> {
  return listen<CodexEvent>("terax:codex-event", (event) => {
    onEvent(event.payload);
  });
}
