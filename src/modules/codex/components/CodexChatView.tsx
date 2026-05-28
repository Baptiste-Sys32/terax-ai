import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  codexAccountSwitch,
  codexAppRequest,
  codexAppRespond,
  codexModelList,
  codexStatus,
  codexThreadFork,
  codexThreadList,
  codexThreadResume,
  codexThreadStart,
  codexTurnInterrupt,
  codexTurnStart,
  listenCodexEvents,
  type CodexAccount,
  type CodexAccountProfile,
  type CodexEvent,
  type CodexModel,
  type CodexPermissionMode,
  type CodexReasoningEffort,
  type CodexStatus,
  type CodexThreadListItem,
  type CodexThreadLoadResponse,
  type CodexThreadStartResponse,
  type CodexUserInput,
} from "@/modules/codex";
import {
  CODEX_PERMISSION_PRESETS,
  REASONING_LABELS,
  codexApprovalResult,
  codexEventThreadId,
  createInitialCodexChatState,
  mergeThreadItems,
  reduceCodexEvent,
  type CodexChatState,
  type CodexPendingRequest,
  type CodexThreadItem,
} from "@/modules/codex/lib/chatState";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import type { CodexTab } from "@/modules/tabs";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  AiBrain04Icon,
  Add01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  ComputerTerminal02Icon,
  File01Icon,
  FileAttachmentIcon,
  Folder01Icon,
  Image02Icon,
  Loading03Icon,
  LockIcon,
  Settings01Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  Ref,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { CodexLogo } from "./CodexLogo";

type Props = {
  tab: CodexTab;
};

type CodexSlashNotice = {
  title: string;
  rows: Array<{ label: string; value: string }>;
  detail?: string;
};

export type CodexAttachment =
  | {
      id: string;
      kind: "path";
      path: string;
      pathKind: "file" | "folder" | "path";
    }
  | {
      id: string;
      kind: "localImage";
      path: string;
      name: string;
    }
  | {
      id: string;
      kind: "image";
      url: string;
      name: string;
    };

type SessionBrowserState =
  | { status: "closed"; sessions: CodexThreadListItem[] }
  | { status: "loading"; sessions: CodexThreadListItem[] }
  | { status: "loaded"; sessions: CodexThreadListItem[] }
  | { status: "error"; sessions: CodexThreadListItem[]; message: string };

const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
const CODEX_SLASH_COMMANDS = [
  {
    name: "new",
    invocation: "/new",
    label: "New",
    description: "Start a fresh Codex thread in this tab.",
  },
  {
    name: "status",
    invocation: "/status",
    label: "Status",
    description: "Show the active Codex account, workspace, model, and permissions.",
  },
  {
    name: "model",
    invocation: "/model",
    label: "Model",
    description: "Inspect or change the active Codex model.",
  },
  {
    name: "compact",
    invocation: "/compact",
    label: "Compact",
    description: "Summarize the current thread to reduce context usage.",
  },
  {
    name: "clear",
    invocation: "/clear",
    label: "Clear",
    description: "Start fresh in the current Codex tab.",
  },
  {
    name: "resume",
    invocation: "/resume",
    label: "Resume",
    description: "Browse or resume recent Codex sessions.",
  },
  {
    name: "fork",
    invocation: "/fork",
    label: "Fork",
    description: "Branch the current Codex thread.",
  },
  {
    name: "exit",
    invocation: "/exit",
    label: "Exit",
    description: "Show the resume id and detach this tab from the thread.",
  },
  {
    name: "help",
    invocation: "/help",
    label: "Help",
    description: "Show Codex command help.",
  },
] as const;
const CODEX_REASONING_EFFORTS = new Set<string>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

type LocalAction =
  | { type: "event"; event: CodexEvent }
  | {
      type: "thread-started";
      threadId: string;
      cwd?: string | null;
      items?: CodexThreadItem[];
    }
  | { type: "turn-started"; turnId: string; items?: CodexThreadItem[] }
  | {
      type: "thread-loaded";
      threadId: string;
      cwd?: string | null;
      items?: CodexThreadItem[];
    }
  | { type: "reset" }
  | { type: "error"; message: string }
  | { type: "resolved"; requestId: string | number };

function chatReducer(state: CodexChatState, action: LocalAction): CodexChatState {
  if (action.type === "event") return reduceCodexEvent(state, action.event);
  if (action.type === "thread-started") {
    return {
      ...state,
      threadId: action.threadId,
      cwd: action.cwd ?? state.cwd,
      status: "running",
      error: null,
      items: action.items
        ? mergeThreadItems(state.items, action.items)
        : state.items,
    };
  }
  if (action.type === "thread-loaded") {
    return {
      ...createInitialCodexChatState(),
      threadId: action.threadId,
      cwd: action.cwd ?? null,
      items: action.items ?? [],
    };
  }
  if (action.type === "reset") return createInitialCodexChatState();
  if (action.type === "turn-started") {
    return {
      ...state,
      turnId: action.turnId,
      status: "running",
      error: null,
      items: action.items
        ? mergeThreadItems(state.items, action.items)
        : state.items,
    };
  }
  if (action.type === "resolved") {
    return {
      ...state,
      pendingRequests: state.pendingRequests.filter(
        (request) => request.requestId !== action.requestId,
      ),
    };
  }
  return { ...state, status: "error", error: action.message };
}

function isReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return typeof value === "string" && CODEX_REASONING_EFFORTS.has(value);
}

function normalizeReasoningEffort(value: unknown): CodexReasoningEffort {
  return isReasoningEffort(value) ? value : DEFAULT_CODEX_REASONING_EFFORT;
}

function formatGptModelName(name: string): string {
  return name.replace(/\bgpt\b/gi, "GPT");
}

function formatCodexModelDisplayName(model: CodexModel): string {
  return formatGptModelName(model.displayName || model.model);
}

function normalizeCodexModels(models: CodexModel[]): CodexModel[] {
  return models
    .filter(
      (model) =>
        !model.hidden &&
        typeof model.model === "string" &&
        model.model.trim().length > 0,
    )
    .map((model) => {
      const supportedReasoningEfforts = Array.isArray(
        model.supportedReasoningEfforts,
      )
        ? model.supportedReasoningEfforts.filter((option) =>
            isReasoningEffort(option?.reasoningEffort),
          )
        : [];
      return {
        ...model,
        id: model.id || model.model,
        model: model.model.trim(),
        displayName: formatCodexModelDisplayName(model),
        supportedReasoningEfforts,
        defaultReasoningEffort: normalizeReasoningEffort(
          model.defaultReasoningEffort,
        ),
      };
    });
}

export function CodexChatView({ tab }: Props) {
  const [state, dispatch] = useReducer(chatReducer, undefined, () =>
    createInitialCodexChatState(),
  );
  const stateRef = useRef(state);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_CODEX_MODEL);
  const [effort, setEffort] = useState<CodexReasoningEffort>(
    DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [permissionMode, setPermissionMode] =
    useState<CodexPermissionMode>("default");
  const [prompt, setPrompt] = useState("");
  const [slashNotice, setSlashNotice] = useState<CodexSlashNotice | null>(null);
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [sessionBrowser, setSessionBrowser] = useState<SessionBrowserState>({
    status: "closed",
    sessions: [],
  });
  const [slashIndex, setSlashIndex] = useState(0);
  const [loadingModels, setLoadingModels] = useState(false);
  const [sending, setSending] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<
    string | number | null
  >(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.model === selectedModel) ?? null,
    [models, selectedModel],
  );

  const supportedEfforts = useMemo(() => {
    const options = selectedModelInfo?.supportedReasoningEfforts ?? [];
    const efforts = options
      .map((option) => option.reasoningEffort)
      .filter(isReasoningEffort);
    return efforts.length > 0
      ? efforts
      : [normalizeReasoningEffort(selectedModelInfo?.defaultReasoningEffort)];
  }, [selectedModelInfo]);

  useEffect(() => {
    if (!supportedEfforts.includes(effort)) {
      setEffort(supportedEfforts[0] ?? "medium");
    }
  }, [effort, supportedEfforts]);

  const loadModels = useCallback(async (nextStatus: CodexStatus) => {
    if (!nextStatus.installed || !nextStatus.account) {
      setModels([]);
      setSelectedModel(DEFAULT_CODEX_MODEL);
      return;
    }

    setLoadingModels(true);
    try {
      const list = await codexModelList();
      const visibleModels = normalizeCodexModels(list.data);
      setModels(visibleModels);
      setSelectedModel((current) => {
        if (current && visibleModels.some((model) => model.model === current)) {
          return current;
        }
        return (
          visibleModels.find((model) => model.model === DEFAULT_CODEX_MODEL)
            ?.model ??
          visibleModels.find((model) => model.isDefault)?.model ??
          visibleModels[0]?.model ??
          ""
        );
      });
      const nextDefault =
        visibleModels.find((model) => model.model === DEFAULT_CODEX_MODEL) ??
        visibleModels.find((model) => model.isDefault) ??
        visibleModels[0];
      if (nextDefault) {
        setEffort(
          nextDefault.model === DEFAULT_CODEX_MODEL
            ? DEFAULT_CODEX_REASONING_EFFORT
            : normalizeReasoningEffort(nextDefault.defaultReasoningEffort),
        );
      }
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const refreshStatusAndModels = useCallback(async () => {
    try {
      const nextStatus = await codexStatus();
      setStatus(nextStatus);
      await loadModels(nextStatus);
    } catch (error) {
      dispatch({ type: "error", message: String(error) });
    }
  }, [loadModels]);

  useEffect(() => {
    void refreshStatusAndModels();
  }, [refreshStatusAndModels]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenCodexEvents((event) => {
      if (disposed) return;
      if (
        event.method === "account/updated" ||
        event.method === "account/login/completed"
      ) {
        void refreshStatusAndModels();
        return;
      }
      const threadId = stateRef.current.threadId;
      const eventThreadId = codexEventThreadId(event);
      if (!threadId || eventThreadId !== threadId) return;
      dispatch({ type: "event", event });
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshStatusAndModels]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.items, state.pendingRequests.length, state.status]);

  const loggedIn = !!status?.account;
  const installed = status?.installed !== false;
  const running = state.status === "running" || sending;
  const activePending = state.pendingRequests[0] ?? null;
  const slashQuery = prompt.match(/^\/([^\s]*)$/)?.[1].toLowerCase() ?? null;
  const slashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    return CODEX_SLASH_COMMANDS.filter(
      (command) =>
        command.name.includes(slashQuery) ||
        command.label.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery]);
  const showSlashCommands = slashQuery !== null && slashCommands.length > 0;

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  const pickSlashCommand = useCallback(
    (command: (typeof CODEX_SLASH_COMMANDS)[number]) => {
      setPrompt(`${command.invocation} `);
      setSlashIndex(0);
    },
    [],
  );

  const currentPreset = useCallback(
    () => CODEX_PERMISSION_PRESETS[permissionMode],
    [permissionMode],
  );

  const showStopFirst = useCallback(() => {
    setSlashNotice({
      title: "Codex",
      rows: [{ label: "Status", value: "Stop the current turn first." }],
    });
  }, []);

  const loadThreadIntoView = useCallback(
    (response: CodexThreadLoadResponse | CodexThreadStartResponse) => {
      const thread = response.thread;
      const threadId = thread.id;
      dispatch({
        type: "thread-loaded",
        threadId,
        cwd: thread.cwd ?? response.cwd ?? null,
        items: flattenThreadItems(thread.turns),
      });
      if (response.model) setSelectedModel(response.model);
      if (isReasoningEffort(response.reasoningEffort)) {
        setEffort(response.reasoningEffort);
      }
      setSessionBrowser((browser) => ({
        status: "closed",
        sessions: browser.sessions,
      }));
    },
    [],
  );

  const startFreshThread = useCallback(
    async (options?: {
      source?: "startup" | "clear";
      showPreviousId?: boolean;
      silent?: boolean;
    }) => {
      if (running) {
        showStopFirst();
        return;
      }
      if (!installed || !loggedIn) {
        void openSettingsWindow("codex");
        return;
      }

      const previousThreadId = stateRef.current.threadId;
      const preset = currentPreset();
      setSending(true);
      setPrompt("");
      setAttachments([]);
      setSessionBrowser((browser) => ({
        status: "closed",
        sessions: browser.sessions,
      }));
      dispatch({ type: "reset" });
      try {
        const started = await codexThreadStart({
          cwd: tab.cwd,
          model: selectedModelInfo?.model,
          approvalPolicy: preset.approvalPolicy,
          sandbox: preset.sandbox,
          sessionStartSource: options?.source,
        });
        loadThreadIntoView(started);
        if (options?.showPreviousId && previousThreadId) {
          setSlashNotice({
            title: "New chat",
            rows: [{ label: "Previous", value: `/resume ${previousThreadId}` }],
          });
        } else if (!options?.silent) {
          setSlashNotice(null);
        }
      } catch (error) {
        dispatch({ type: "error", message: String(error) });
      } finally {
        setSending(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [
      currentPreset,
      installed,
      loadThreadIntoView,
      loggedIn,
      running,
      selectedModelInfo?.model,
      showStopFirst,
      tab.cwd,
    ],
  );

  const openSessionBrowser = useCallback(async () => {
    if (running) {
      showStopFirst();
      return;
    }
    if (!installed || !loggedIn) {
      void openSettingsWindow("codex");
      return;
    }
    setSessionBrowser((browser) => ({
      status: "loading",
      sessions: browser.sessions,
    }));
    try {
      const response = await codexThreadList({
        limit: 30,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
      });
      const sessions = normalizeThreadList(response);
      setSessionBrowser({ status: "loaded", sessions });
      setSlashNotice(null);
    } catch (error) {
      setSessionBrowser((browser) => ({
        status: "error",
        sessions: browser.sessions,
        message: String(error),
      }));
    }
  }, [installed, loggedIn, running, showStopFirst]);

  const resumeThread = useCallback(
    async (threadId: string) => {
      if (running) {
        showStopFirst();
        return;
      }
      if (!threadId) return;
      const preset = currentPreset();
      setSending(true);
      setPrompt("");
      setAttachments([]);
      setSlashNotice(null);
      try {
        const response = await codexThreadResume({
          threadId,
          cwd: stateRef.current.cwd ?? tab.cwd,
          model: selectedModelInfo?.model,
          approvalPolicy: preset.approvalPolicy,
          sandbox: preset.sandbox,
        });
        loadThreadIntoView(response);
      } catch (error) {
        dispatch({ type: "error", message: String(error) });
      } finally {
        setSending(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [
      currentPreset,
      loadThreadIntoView,
      running,
      selectedModelInfo?.model,
      showStopFirst,
      tab.cwd,
    ],
  );

  const forkThread = useCallback(async () => {
    if (running) {
      showStopFirst();
      return;
    }
    const threadId = stateRef.current.threadId;
    if (!threadId) {
      setSlashNotice({
        title: "Fork",
        rows: [{ label: "Status", value: "Start a Codex thread first." }],
      });
      return;
    }
    const preset = currentPreset();
    setSending(true);
    setPrompt("");
    setAttachments([]);
    setSlashNotice(null);
    try {
      const response = await codexThreadFork({
        threadId,
        cwd: stateRef.current.cwd ?? tab.cwd,
        model: selectedModelInfo?.model,
        approvalPolicy: preset.approvalPolicy,
        sandbox: preset.sandbox,
      });
      loadThreadIntoView(response);
    } catch (error) {
      dispatch({ type: "error", message: String(error) });
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [
    currentPreset,
    loadThreadIntoView,
    running,
    selectedModelInfo?.model,
    showStopFirst,
    tab.cwd,
  ]);

  const runSlashCommand = useCallback(
    async (text: string): Promise<boolean> => {
      const rawCommand = text.trim();
      const command = rawCommand.toLowerCase();
      if (command === "/new") {
        await startFreshThread({ showPreviousId: true });
        return true;
      }
      if (command === "/status") {
        const rateLimits = await codexAppRequest<Record<string, unknown>>(
          "account/rateLimits/read",
        ).catch(() => null);
        const limit = bestRateLimit(rateLimits);
        const account = status?.account
          ? formatAccountDetail(status.account)
          : "Signed out";
        const model =
          selectedModelInfo?.displayName ?? formatGptModelName(selectedModel);
        const preset = CODEX_PERMISSION_PRESETS[permissionMode];
        setSlashNotice({
          title: "OpenAI Codex",
          rows: [
            { label: "Version", value: status?.version ?? "Unknown" },
            {
              label: "Model",
              value: `${model} (reasoning ${REASONING_LABELS[effort] ?? effort})`,
            },
            { label: "Directory", value: tab.cwd ?? "~" },
            { label: "Permissions", value: preset.label },
            { label: "Account", value: account },
            { label: "Session", value: stateRef.current.threadId ?? "<none>" },
            {
              label: "5h limit",
              value: formatRateLimitWindow(limit?.primary),
            },
            {
              label: "Weekly limit",
              value: formatRateLimitWindow(limit?.secondary),
            },
          ],
          detail:
            "Visit https://chatgpt.com/codex/settings/usage for up-to-date information on rate limits and credits.",
        });
        setPrompt("");
        return true;
      }
      if (command === "/model") {
        modelButtonRef.current?.focus();
        modelButtonRef.current?.click();
        setPrompt("");
        return true;
      }
      if (command === "/compact") {
        const threadId = stateRef.current.threadId;
        if (!threadId) {
          setSlashNotice({
            title: "Compact",
            rows: [{ label: "Status", value: "Start a Codex thread first." }],
          });
          setPrompt("");
          return true;
        }
        await codexAppRequest("thread/compact/start", { threadId });
        setSlashNotice({
          title: "Compact",
          rows: [{ label: "Status", value: "Compaction started." }],
        });
        setPrompt("");
        return true;
      }
      if (command === "/clear") {
        await startFreshThread({ source: "clear", silent: true });
        return true;
      }
      if (command === "/resume") {
        setPrompt("");
        await openSessionBrowser();
        return true;
      }
      if (command.startsWith("/resume ")) {
        const threadId = rawCommand.slice("/resume ".length).trim();
        setPrompt("");
        await resumeThread(threadId);
        return true;
      }
      if (command === "/fork") {
        await forkThread();
        return true;
      }
      if (command === "/exit") {
        if (running) {
          showStopFirst();
          return true;
        }
        const threadId = stateRef.current.threadId;
        setSlashNotice({
          title: "Exit",
          rows: [
            {
              label: "Resume",
              value: threadId
                ? `To continue this session, use /resume ${threadId}`
                : "No active Codex session.",
            },
          ],
        });
        setPrompt("");
        setAttachments([]);
        dispatch({ type: "reset" });
        return true;
      }
      if (command === "/help") {
        setSlashNotice({
          title: "Commands",
          rows: CODEX_SLASH_COMMANDS.map((item) => ({
            label: item.invocation,
            value: item.description,
          })),
        });
        setPrompt("");
        return true;
      }
      return false;
    },
    [
      currentPreset,
      effort,
      forkThread,
      openSessionBrowser,
      permissionMode,
      resumeThread,
      selectedModel,
      selectedModelInfo?.displayName,
      showStopFirst,
      startFreshThread,
      status?.account,
      status?.version,
      tab.cwd,
      running,
    ],
  );

  const switchAccount = useCallback(
    async (profileId: string) => {
      if (!profileId || profileId === status?.activeAccountId) return;
      try {
        setLoadingModels(true);
        setModels([]);
        setSelectedModel("");
        const nextStatus = await codexAccountSwitch(profileId);
        setStatus(nextStatus);
        await loadModels(nextStatus);
        dispatch({ type: "reset" });
        setPrompt("");
        setAttachments([]);
        setSlashNotice(null);
        setSessionBrowser((browser) => ({
          status: "closed",
          sessions: browser.sessions,
        }));
        if (nextStatus.installed && nextStatus.account) {
          const preset = currentPreset();
          const started = await codexThreadStart({
            cwd: tab.cwd,
            model: selectedModelInfo?.model,
            approvalPolicy: preset.approvalPolicy,
            sandbox: preset.sandbox,
          });
          loadThreadIntoView(started);
        }
      } catch (error) {
        dispatch({ type: "error", message: String(error) });
      } finally {
        setLoadingModels(false);
      }
    },
    [
      currentPreset,
      loadModels,
      loadThreadIntoView,
      selectedModelInfo?.model,
      status?.activeAccountId,
      tab.cwd,
    ],
  );

  const submitPrompt = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = prompt.trim();
      if ((!text && attachments.length === 0) || sending) return;
      if (attachments.length === 0 && text && (await runSlashCommand(text))) return;
      if (!installed || !loggedIn) {
        void openSettingsWindow("codex");
        return;
      }

      const preset = CODEX_PERMISSION_PRESETS[permissionMode];
      const input = codexInputFromComposer(text, attachments);
      if (input.length === 0) return;
      setSending(true);
      setSlashNotice(null);
      setSessionBrowser((browser) => ({
        status: "closed",
        sessions: browser.sessions,
      }));
      setPrompt("");
      setAttachments([]);
      try {
        let threadId = stateRef.current.threadId;
        if (!threadId) {
          const started = await codexThreadStart({
            cwd: tab.cwd,
            model: selectedModelInfo?.model,
            approvalPolicy: preset.approvalPolicy,
            sandbox: preset.sandbox,
          });
          threadId = started.thread.id;
          dispatch({
            type: "thread-started",
            threadId,
            cwd: started.thread.cwd ?? started.cwd ?? tab.cwd ?? null,
            items: flattenThreadItems(started.thread.turns),
          });
        }

        const turn = await codexTurnStart({
          threadId,
          input,
          cwd: stateRef.current.cwd ?? tab.cwd,
          model: selectedModelInfo?.model,
          effort,
          approvalPolicy: preset.approvalPolicy,
        });
        dispatch({
          type: "turn-started",
          turnId: turn.turn.id,
          items: flattenThreadItems([turn.turn]),
        });
      } catch (error) {
        setPrompt(text);
        setAttachments(attachments);
        dispatch({ type: "error", message: String(error) });
      } finally {
        setSending(false);
      }
    },
    [
      effort,
      installed,
      loggedIn,
      permissionMode,
      prompt,
      runSlashCommand,
      selectedModelInfo?.model,
      sending,
      tab.cwd,
      attachments,
    ],
  );

  const stopTurn = useCallback(async () => {
    const threadId = stateRef.current.threadId;
    const turnId = stateRef.current.turnId;
    if (!threadId || !turnId) return;
    try {
      await codexTurnInterrupt({ threadId, turnId });
    } catch (error) {
      dispatch({ type: "error", message: String(error) });
    }
  }, []);

  useEffect(() => {
    const onAttach = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (typeof path !== "string" || path.length === 0) return;
      void createPathAttachment(path).then((attachment) => {
        setAttachments((current) => appendAttachment(current, attachment));
        requestAnimationFrame(() => textareaRef.current?.focus());
      });
    };
    window.addEventListener("terax:codex-attach-path", onAttach);
    return () => window.removeEventListener("terax:codex-attach-path", onAttach);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }, []);

  const queueAttachments = useCallback((next: CodexAttachment[]) => {
    if (next.length === 0) return;
    setAttachments((current) =>
      next.reduce((acc, attachment) => appendAttachment(acc, attachment), current),
    );
  }, []);

  const readSystemClipboardImages = useCallback(async () => {
    const result = await readClipboardAttachments();
    if (result.attachments.length > 0) queueAttachments(result.attachments);
  }, [queueAttachments]);

  const readSystemClipboard = useCallback(async () => {
    const result = await readClipboardAttachments();
    if (result.attachments.length > 0) queueAttachments(result.attachments);
    const text = result.text;
    if (text) {
      setPrompt((current) => insertTextAtTextarea(current, text, textareaRef.current));
    }
  }, [queueAttachments]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const payload = attachmentsFromClipboardData(event.clipboardData);
      if (payload.length === 0) {
        window.setTimeout(() => void readSystemClipboardImages(), 0);
        return;
      }
      event.preventDefault();
      void Promise.all(payload.map((item) => createImageAttachment(item.blob, item.name))).then(
        queueAttachments,
      );
    },
    [queueAttachments, readSystemClipboardImages],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const pasteChord =
        event.key.toLowerCase() === "v" && (event.ctrlKey || event.metaKey);
      if (pasteChord) {
        window.setTimeout(() => void readSystemClipboardImages(), 0);
      }

      if (showSlashCommands) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((index) => (index + 1) % slashCommands.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex(
            (index) =>
              (index - 1 + slashCommands.length) %
              slashCommands.length,
          );
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const command = slashCommands[slashIndex];
          if (command) pickSlashCommand(command);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (showSlashCommands) {
          const exact = slashCommands.find(
            (command) => command.invocation === prompt.trim(),
          );
          if (exact) {
            void submitPrompt();
            return;
          }
          const command = slashCommands[slashIndex];
          if (command) pickSlashCommand(command);
          return;
        }
        void submitPrompt();
      }
    },
    [
      pickSlashCommand,
      prompt,
      readSystemClipboardImages,
      showSlashCommands,
      slashCommands,
      slashIndex,
      submitPrompt,
    ],
  );

  const handleAuxClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      if (event.button !== 1) return;
      void readSystemClipboard();
    },
    [readSystemClipboard],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasCodexDropPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasCodexDropPayload(event.dataTransfer)) return;
      event.preventDefault();
      void codexAttachmentsFromDrop(event.dataTransfer).then((result) => {
        queueAttachments(result.attachments);
        const text = result.text;
        if (text) {
          setPrompt((current) =>
            insertTextAtTextarea(current, text, textareaRef.current),
          );
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
      });
    },
    [queueAttachments],
  );

  const respondToRequest = useCallback(
    async (
      request: CodexPendingRequest,
      action:
        | "accept"
        | "acceptForSession"
        | "decline"
        | "cancel"
        | "allowTurn"
        | "allowSession",
      customResult?: Record<string, unknown>,
    ) => {
      setRespondingRequestId(request.requestId);
      try {
        await codexAppRespond(
          request.requestId,
          customResult ?? codexApprovalResult(request, action),
        );
        dispatch({ type: "resolved", requestId: request.requestId });
      } catch (error) {
        dispatch({ type: "error", message: String(error) });
      } finally {
        setRespondingRequestId(null);
      }
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <CodexLogo size={20} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium">Codex</span>
              {running ? (
                <Badge variant="secondary" className="h-4 gap-1 px-1.5 text-[10px]">
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={10}
                    strokeWidth={1.75}
                    className="animate-spin"
                  />
                  Working
                </Badge>
              ) : null}
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              {tab.cwd ?? "No workspace folder"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusPill
            status={status}
            loading={loadingModels}
            onAccountChange={switchAccount}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            title="Codex settings"
            onClick={() => void openSettingsWindow("codex")}
          >
            <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-208 flex-col gap-5 px-4 py-6">
          {state.items.length === 0 ? (
            <EmptyState
              loggedIn={loggedIn}
              installed={installed}
              onOpenSettings={() => void openSettingsWindow("codex")}
            />
          ) : (
            state.items.map((item) => <CodexItem key={item.id} item={item} />)
          )}
          {state.warning ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
              {state.warning}
            </div>
          ) : null}
          {state.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive">
              {state.error}
            </div>
          ) : null}
          {slashNotice ? <CodexSlashNoticeCard notice={slashNotice} /> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <form onSubmit={submitPrompt} className="mx-auto w-full max-w-208">
          {sessionBrowser.status !== "closed" ? (
            <SessionBrowserPanel
              browser={sessionBrowser}
              currentThreadId={state.threadId}
              onResume={resumeThread}
              onClose={() =>
                setSessionBrowser((browser) => ({
                  status: "closed",
                  sessions: browser.sessions,
                }))
              }
            />
          ) : null}
          <div
            className="rounded-[22px] p-px transition-colors focus-within:bg-ring/30"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div className="overflow-hidden rounded-[20px] border border-border bg-card">
              {activePending ? (
                <div className="border-b border-border/60 bg-muted/20">
                  <PendingRequestPanel
                    request={activePending}
                    pendingCount={state.pendingRequests.length}
                    responding={respondingRequestId === activePending.requestId}
                    onRespond={respondToRequest}
                  />
                </div>
              ) : null}

              <div className="px-3 pt-3">
                <Textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={handleComposerKeyDown}
                  onAuxClick={handleAuxClick}
                  placeholder={
                    loggedIn
                      ? "Ask Codex to work in this repository..."
                      : "Sign in to use Codex..."
                  }
                  disabled={!installed || !loggedIn || !!activePending}
                  className="max-h-42 min-h-20 border-0 bg-transparent px-1 py-0 text-[13px] shadow-none focus-visible:ring-0"
                />
              </div>

              {showSlashCommands ? (
                <CodexSlashCommandMenu
                  commands={slashCommands}
                  activeIndex={slashIndex}
                  onHover={setSlashIndex}
                  onPick={pickSlashCommand}
                />
              ) : null}

              {attachments.length > 0 ? (
                <AttachmentTray
                  attachments={attachments}
                  onRemove={removeAttachment}
                />
              ) : null}

              <div className="flex min-w-0 items-center justify-between gap-2 px-2.5 pb-2.5">
                <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    title="New chat"
                    disabled={running || !installed || !loggedIn}
                    onClick={() => void startFreshThread({ showPreviousId: true })}
                    className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.9} />
                  </Button>
                  <div className="mx-1 h-5 w-px shrink-0 bg-border/70" />
                  <ModelSelect
                    models={models}
                    value={selectedModel}
                    disabled={!loggedIn || loadingModels}
                    onChange={setSelectedModel}
                    triggerRef={modelButtonRef}
                  />
                  <ReasoningSelect
                    value={effort}
                    efforts={supportedEfforts}
                    disabled={!loggedIn}
                    onChange={setEffort}
                  />
                  <PermissionSelect
                    value={permissionMode}
                    onChange={setPermissionMode}
                  />
                </div>

                {running ? (
                  <button
                    type="button"
                    onClick={() => void stopTurn()}
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white transition-transform hover:scale-105 hover:bg-rose-500"
                    title="Stop"
                  >
                    <HugeiconsIcon icon={SquareIcon} size={12} strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      (!prompt.trim() && attachments.length === 0) ||
                      !installed ||
                      !loggedIn ||
                      !!activePending ||
                      sending
                    }
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-transform enabled:cursor-pointer enabled:hover:scale-105 enabled:hover:bg-primary disabled:opacity-35"
                    title="Send"
                  >
                    <HugeiconsIcon
                      icon={ArrowUp01Icon}
                      size={14}
                      strokeWidth={2}
                    />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({
  loggedIn,
  installed,
  onOpenSettings,
}: {
  loggedIn: boolean;
  installed: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex min-h-[42vh] flex-col items-center justify-center gap-4 text-center">
      <CodexLogo size={46} className="shadow-sm" />
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold tracking-normal">
          What should Codex work on?
        </h2>
      </div>
      {!installed || !loggedIn ? (
        <Button size="sm" className="h-8 gap-1.5 px-3" onClick={onOpenSettings}>
          <CodexLogo size={14} />
          {installed ? "Sign in to Codex" : "Configure Codex"}
        </Button>
      ) : null}
    </div>
  );
}

function StatusPill({
  status,
  loading,
  onAccountChange,
}: {
  status: CodexStatus | null;
  loading: boolean;
  onAccountChange: (profileId: string) => void;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className="h-5 gap-1 text-[10.5px]">
        <HugeiconsIcon icon={Loading03Icon} size={10} className="animate-spin" />
        Checking
      </Badge>
    );
  }
  if (!status.installed) {
    return (
      <Badge variant="destructive" className="h-5 gap-1 text-[10.5px]">
        Missing CLI
      </Badge>
    );
  }
  if (!status.account) {
    return (
      <Badge variant="outline" className="h-5 gap-1 text-[10.5px]">
        Signed out
      </Badge>
    );
  }
  const accounts = (status.accounts ?? []).filter((profile) => profile.account);
  const activeId =
    status.activeAccountId ??
    accounts.find((profile) => profile.active)?.id ??
    accounts[0]?.id ??
    "default";
  const active = accounts.find((profile) => profile.id === activeId) ?? null;

  return (
    <Select value={activeId} onValueChange={onAccountChange} disabled={loading}>
      <SelectTrigger
        size="sm"
        className="h-5 min-w-28 max-w-56 justify-start gap-1.5 rounded-full border-border/70 bg-secondary px-2 text-[10.5px] font-medium text-secondary-foreground hover:bg-secondary/80"
        title={active ? accountProfileTitle(active) : "Signed in"}
      >
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} strokeWidth={1.75} />
        <SelectValue>
          <span className="truncate">
            {loading ? "Loading" : active?.label ?? "Signed in"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-64 rounded-2xl">
        {accounts.length === 0 ? (
          <SelectItem value="__none" disabled>
            No signed-in accounts
          </SelectItem>
        ) : (
          accounts.map((profile) => (
            <SelectItem key={profile.id} value={profile.id} className="py-2">
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate text-[12px] font-medium">
                  {profile.label}
                </span>
                <span className="truncate text-[10.5px] text-muted-foreground">
                  {formatAccountDetail(profile.account ?? null)}
                </span>
              </div>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function accountProfileTitle(profile: CodexAccountProfile): string {
  return `${profile.label} - ${formatAccountDetail(profile.account ?? null)}`;
}

function SessionBrowserPanel({
  browser,
  currentThreadId,
  onResume,
  onClose,
}: {
  browser: SessionBrowserState;
  currentThreadId: string | null;
  onResume: (threadId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            icon={Clock01Icon}
            size={13}
            strokeWidth={1.75}
            className="text-muted-foreground"
          />
          <span className="text-[12px] font-medium">Recent sessions</span>
          {browser.status === "loading" ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={12}
              strokeWidth={1.75}
              className="animate-spin text-muted-foreground"
            />
          ) : null}
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Close"
          onClick={onClose}
          className="size-6"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </div>
      {browser.status === "error" ? (
        <div className="px-3 py-2 text-[11.5px] text-destructive">
          {browser.message}
        </div>
      ) : null}
      {browser.status === "loaded" && browser.sessions.length === 0 ? (
        <div className="px-3 py-3 text-[11.5px] text-muted-foreground">
          No recent Codex sessions found for this account.
        </div>
      ) : null}
      {browser.sessions.length > 0 ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {browser.sessions.map((session) => {
            const id = session.id;
            const selected = id === currentThreadId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onResume(id)}
                className={cn(
                  "grid w-full gap-1 rounded-lg px-2.5 py-2 text-left text-[11.5px] hover:bg-accent",
                  selected && "bg-accent/70",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {sessionTitle(session)}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                    {shortThreadId(id)}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
                  <span className="min-w-0 max-w-full truncate font-mono">
                    {stringField(session.cwd) ?? "No cwd"}
                  </span>
                  <span>{formatSessionUpdated(session)}</span>
                  <span>{sessionSource(session)}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: CodexAttachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: CodexAttachment;
  onRemove: (id: string) => void;
}) {
  const icon =
    attachment.kind === "image" || attachment.kind === "localImage"
      ? Image02Icon
      : attachment.pathKind === "folder"
        ? Folder01Icon
        : FileAttachmentIcon;
  const label =
    attachment.kind === "image"
      ? attachment.name
      : attachment.kind === "localImage"
        ? attachment.name
        : attachment.path;

  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-2 text-[11px]">
      {attachment.kind === "image" ? (
        <img
          src={attachment.url}
          alt=""
          className="size-4 rounded-sm object-cover"
        />
      ) : (
        <HugeiconsIcon
          icon={icon}
          size={12}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
      )}
      <span className="min-w-0 truncate font-mono">{label}</span>
      <button
        type="button"
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
        title="Remove attachment"
        onClick={() => onRemove(attachment.id)}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.8} />
      </button>
    </span>
  );
}

function CodexSlashNoticeCard({ notice }: { notice: CodexSlashNotice }) {
  return (
    <div className="mx-auto w-full max-w-148 rounded-xl border border-border/70 bg-card/85 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
        <CodexLogo size={15} />
        <span>{notice.title}</span>
      </div>
      {notice.detail ? (
        <p className="mb-3 text-[11px] leading-5 text-muted-foreground">
          {notice.detail}
        </p>
      ) : null}
      <dl className="grid gap-1.5 font-mono text-[11.5px]">
        {notice.rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[8rem_1fr] gap-3">
            <dt className="text-muted-foreground">{row.label}:</dt>
            <dd className="min-w-0 truncate text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatAccountDetail(account: CodexAccount | null): string {
  if (!account) return "Signed out";
  if (account.type === "chatgpt") {
    const plan = "planType" in account ? account.planType : null;
    return plan ? `ChatGPT ${String(plan)}` : "ChatGPT";
  }
  if (account.type === "apiKey") return "OpenAI API key";
  if (account.type === "amazonBedrock") return "Amazon Bedrock";
  return String(account.type ?? "Codex account");
}

function bestRateLimit(
  response: Record<string, unknown> | null,
): { primary?: Record<string, unknown>; secondary?: Record<string, unknown> } | null {
  if (!response) return null;
  const byId = asObject(response.rateLimitsByLimitId);
  const codex = asObject(byId.codex);
  const fallback = asObject(response.rateLimits);
  const selected = Object.keys(codex).length > 0 ? codex : fallback;
  if (Object.keys(selected).length === 0) return null;
  return {
    primary: asObject(selected.primary),
    secondary: asObject(selected.secondary),
  };
}

function formatRateLimitWindow(window: Record<string, unknown> | undefined): string {
  if (!window || Object.keys(window).length === 0) return "Unavailable";
  const used = typeof window.usedPercent === "number" ? window.usedPercent : null;
  const left = used === null ? null : Math.max(0, 100 - used);
  const reset =
    typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt)
      ? `, resets ${formatResetTime(window.resetsAt)}`
      : "";
  return left === null ? `Unavailable${reset}` : `${Math.round(left)}% left${reset}`;
}

function formatResetTime(timestamp: number): string {
  const millis = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ModelSelect({
  models,
  value,
  disabled,
  onChange,
  triggerRef,
}: {
  models: CodexModel[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const selected = models.find((model) => model.model === value) ?? null;
  const selectedLabel = selected?.displayName ?? formatGptModelName(value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        ref={triggerRef}
        size="sm"
        className="max-w-48 shrink justify-start overflow-hidden border-0 bg-transparent px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:max-w-56 sm:px-3"
        title={selectedLabel || "Model"}
      >
        <CodexLogo size={14} />
        <SelectValue placeholder="Model">
          <span className="min-w-0 truncate">
            {selectedLabel || "Model"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-80 min-w-72 rounded-2xl">
        {models.length === 0 ? (
          <SelectItem value="__none" disabled>
            No Codex models
          </SelectItem>
        ) : (
          models.map((model) => (
            <SelectItem key={model.id} value={model.model}>
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate text-[12px] font-medium">
                  {model.displayName}
                </span>
                {model.description ? (
                  <span className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {model.description}
                  </span>
                ) : null}
              </div>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function CodexSlashCommandMenu({
  commands,
  activeIndex,
  onHover,
  onPick,
}: {
  commands: readonly (typeof CODEX_SLASH_COMMANDS)[number][];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (command: (typeof CODEX_SLASH_COMMANDS)[number]) => void;
}) {
  return (
    <div className="border-t border-border/60 bg-muted/20 px-2 py-1.5">
      <div className="max-h-44 overflow-y-auto rounded-xl border border-border/60 bg-popover/95 p-1 shadow-sm backdrop-blur">
        {commands.map((command, index) => (
          <button
            key={command.name}
            type="button"
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(command);
            }}
            className={cn(
              "grid w-full grid-cols-[4.5rem_1fr] items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]",
              index === activeIndex ? "bg-accent" : "hover:bg-accent/60",
            )}
          >
            <span className="font-mono text-[11.5px] font-medium text-foreground">
              {command.invocation}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="font-medium leading-none">{command.label}</span>
              <span className="line-clamp-1 text-[10.5px] leading-4 text-muted-foreground">
                {command.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReasoningSelect({
  value,
  efforts,
  disabled,
  onChange,
}: {
  value: CodexReasoningEffort;
  efforts: CodexReasoningEffort[];
  disabled: boolean;
  onChange: (value: CodexReasoningEffort) => void;
}) {
  const label = REASONING_LABELS[value] ?? value;

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as CodexReasoningEffort)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className="shrink-0 justify-start border-0 bg-transparent px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:px-3"
        title={`Reasoning: ${label}`}
      >
        <HugeiconsIcon icon={AiBrain04Icon} size={14} strokeWidth={1.75} />
        <SelectValue>
          <span>{label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="rounded-2xl">
        {efforts.map((option) => (
          <SelectItem key={option} value={option} className="min-w-44">
            {REASONING_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PermissionSelect({
  value,
  onChange,
}: {
  value: CodexPermissionMode;
  onChange: (value: CodexPermissionMode) => void;
}) {
  const selected = CODEX_PERMISSION_PRESETS[value];
  const PermissionIcon =
    value === "full-access" ? CheckmarkCircle02Icon : LockIcon;

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as CodexPermissionMode)}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "shrink-0 justify-start border-0 bg-transparent px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:px-3",
          value === "full-access" && "text-rose-500 hover:text-rose-500",
        )}
        title={selected.description}
      >
        <HugeiconsIcon icon={PermissionIcon} size={14} strokeWidth={1.75} />
        <SelectValue>
          <span>{selected.label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-64 rounded-2xl">
        {(Object.keys(CODEX_PERMISSION_PRESETS) as CodexPermissionMode[]).map(
          (key) => {
            const preset = CODEX_PERMISSION_PRESETS[key];
            const OptionIcon =
              key === "full-access" ? CheckmarkCircle02Icon : LockIcon;
            return (
              <SelectItem key={key} value={key} className="py-2">
                <div className="grid gap-0.5">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                    <HugeiconsIcon
                      icon={OptionIcon}
                      size={13}
                      strokeWidth={1.75}
                      className="text-muted-foreground"
                    />
                    {preset.label}
                  </span>
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    {preset.description}
                  </span>
                </div>
              </SelectItem>
            );
          },
        )}
      </SelectContent>
    </Select>
  );
}

function CodexItem({ item }: { item: CodexThreadItem }) {
  if (item.type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const textParts = content.flatMap((part) =>
      part.type === "text" && "text" in part && typeof part.text === "string"
        ? [part.text]
        : [],
    );
    const text = textParts
      .filter((value) => !isAttachedPathsBlock(value))
      .join("\n");
    const pathBlocks = textParts.flatMap((textPart) =>
      parseAttachedPaths(textPart),
    );
    const images: Array<
      { type: "image"; url: string } | { type: "localImage"; path: string }
    > = [];
    for (const part of content) {
      if (part.type === "image" && "url" in part && typeof part.url === "string") {
        images.push({ type: "image", url: part.url });
      }
      if (
        part.type === "localImage" &&
        "path" in part &&
        typeof part.path === "string"
      ) {
        images.push({ type: "localImage", path: part.path });
      }
    }
    return (
      <Message from="user">
        <MessageContent>
          <div className="grid gap-2">
            {text ? (
              <p className="whitespace-pre-wrap wrap-break-word">{text}</p>
            ) : null}
            {pathBlocks.length > 0 || images.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {pathBlocks.map((attachment) => (
                  <span
                    key={`${attachment.path}-${attachment.kind}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-[11px]"
                  >
                    <HugeiconsIcon
                      icon={
                        attachment.kind === "folder"
                          ? Folder01Icon
                          : FileAttachmentIcon
                      }
                      size={12}
                      strokeWidth={1.75}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 truncate font-mono">
                      {attachment.path}
                    </span>
                  </span>
                ))}
                {images.map((image, index) =>
                  image.type === "image" ? (
                    <img
                      key={`image-${index}`}
                      src={image.url}
                      alt="Attached image"
                      className="max-h-28 max-w-44 rounded-md border border-border/70 object-contain"
                    />
                  ) : (
                    <span
                      key={`local-image-${index}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-[11px]"
                    >
                      <HugeiconsIcon
                        icon={Image02Icon}
                        size={12}
                        strokeWidth={1.75}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 truncate font-mono">
                        {image.path}
                      </span>
                    </span>
                  ),
                )}
              </div>
            ) : null}
          </div>
        </MessageContent>
      </Message>
    );
  }

  if (item.type === "agentMessage") {
    return (
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>{item.text}</MessageResponse>
        </MessageContent>
      </Message>
    );
  }

  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary : [];
    const content = Array.isArray(item.content) ? item.content : [];
    const text = [...summary, ...content].filter(Boolean).join("\n\n");
    if (!text) return null;
    return (
      <Message from="assistant">
        <MessageContent>
          <Reasoning>
            <ReasoningTrigger />
            <ReasoningContent>{text}</ReasoningContent>
          </Reasoning>
        </MessageContent>
      </Message>
    );
  }

  if (item.type === "plan") {
    return (
      <Message from="assistant">
        <MessageContent>
          <div className="rounded-lg border border-border/60 bg-card/60 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase text-muted-foreground">
              Plan
            </div>
            <MessageResponse>{item.text}</MessageResponse>
          </div>
        </MessageContent>
      </Message>
    );
  }

  if (item.type === "commandExecution") {
    return <CommandExecutionItem item={item} />;
  }

  if (item.type === "fileChange") {
    return <FileChangeItem item={item} />;
  }

  return null;
}

function CommandExecutionItem({
  item,
}: {
  item: Extract<CodexThreadItem, { type: "commandExecution" }>;
}) {
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card/60">
          <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-[11px]">
            <HugeiconsIcon
              icon={ComputerTerminal02Icon}
              size={13}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span className="font-medium">Command</span>
            {item.status ? (
              <span className="ml-auto text-muted-foreground">{item.status}</span>
            ) : null}
          </div>
          {item.command ? (
            <div className="border-b border-border/50 px-3 py-2 font-mono text-[11px]">
              {item.command}
            </div>
          ) : null}
          {item.aggregatedOutput ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {item.aggregatedOutput}
            </pre>
          ) : null}
        </div>
      </MessageContent>
    </Message>
  );
}

function FileChangeItem({
  item,
}: {
  item: Extract<CodexThreadItem, { type: "fileChange" }>;
}) {
  const changes = Array.isArray(item.changes) ? item.changes : [];

  return (
    <Message from="assistant">
      <MessageContent>
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card/60">
          <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 text-[11px]">
            <HugeiconsIcon
              icon={File01Icon}
              size={13}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span className="font-medium">File changes</span>
            {item.status ? (
              <span className="ml-auto text-muted-foreground">{item.status}</span>
            ) : null}
          </div>
          <div className="flex flex-col divide-y divide-border/50">
            {changes.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                No file details reported.
              </div>
            ) : null}
            {changes.map((change, index) => (
              <details key={`${change.path}-${index}`} className="group">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {change.path}
                  </span>
                  {change.kind ? (
                    <span className="text-muted-foreground">{change.kind}</span>
                  ) : null}
                </summary>
                {change.diff ? (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {change.diff}
                  </pre>
                ) : null}
              </details>
            ))}
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function PendingRequestPanel({
  request,
  pendingCount,
  responding,
  onRespond,
}: {
  request: CodexPendingRequest;
  pendingCount: number;
  responding: boolean;
  onRespond: (
    request: CodexPendingRequest,
    action:
      | "accept"
      | "acceptForSession"
      | "decline"
      | "cancel"
      | "allowTurn"
      | "allowSession",
    customResult?: Record<string, unknown>,
  ) => void;
}) {
  if (request.method === "item/tool/requestUserInput") {
    return (
      <PendingUserInputPanel
        request={request}
        pendingCount={pendingCount}
        responding={responding}
        onRespond={onRespond}
      />
    );
  }

  const command = stringParam(request.params.command);
  const cwd = stringParam(request.params.cwd);
  const reason = stringParam(request.params.reason);
  const title =
    request.method === "item/commandExecution/requestApproval"
      ? "Command approval requested"
      : request.method === "item/fileChange/requestApproval"
        ? "File-change approval requested"
        : "Permission approval requested";

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Pending approval
        </span>
        <span className="text-[12px] font-medium">{title}</span>
        {pendingCount > 1 ? (
          <span className="text-[11px] text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>
      {command ? (
        <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-background/70 px-2 py-1.5 font-mono text-[11px]">
          {command}
        </pre>
      ) : null}
      {cwd || reason ? (
        <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
          {cwd ? <span className="truncate font-mono">{cwd}</span> : null}
          {reason ? <span>{reason}</span> : null}
        </div>
      ) : null}
      {request.method === "item/permissions/requestApproval" ? (
        <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-background/70 px-2 py-1.5 font-mono text-[10.5px] text-muted-foreground">
          {JSON.stringify(request.params.permissions ?? {}, null, 2)}
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={responding}
          onClick={() => onRespond(request, "decline")}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          Deny
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={responding}
          onClick={() =>
            onRespond(
              request,
              request.method === "item/permissions/requestApproval"
                ? "allowTurn"
                : "accept",
            )
          }
        >
          Allow once
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={responding}
          onClick={() =>
            onRespond(
              request,
              request.method === "item/permissions/requestApproval"
                ? "allowSession"
                : "acceptForSession",
            )
          }
        >
          Allow session
        </Button>
      </div>
    </div>
  );
}

function PendingUserInputPanel({
  request,
  pendingCount,
  responding,
  onRespond,
}: {
  request: CodexPendingRequest;
  pendingCount: number;
  responding: boolean;
  onRespond: (
    request: CodexPendingRequest,
    action: "accept" | "decline",
    customResult?: Record<string, unknown>,
  ) => void;
}) {
  const questions = Array.isArray(request.params.questions)
    ? (request.params.questions as Array<Record<string, unknown>>)
    : [];
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const submit = () => {
    const result = {
      answers: Object.fromEntries(
        questions.flatMap((question) => {
          const id = stringParam(question.id);
          if (!id) return [];
          return [[id, { answers: [answers[id] ?? ""] }]];
        }),
      ),
    };
    onRespond(request, "accept", result);
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Input requested
        </span>
        {pendingCount > 1 ? (
          <span className="text-[11px] text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3">
        {questions.map((question, index) => {
          const id = stringParam(question.id) ?? `q-${index}`;
          const options = Array.isArray(question.options)
            ? (question.options as Array<Record<string, unknown>>)
            : [];
          return (
            <div key={id} className="grid gap-2">
              <label className="text-[12px] font-medium">
                {stringParam(question.question) ?? stringParam(question.header) ?? "Question"}
              </label>
              {options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {options.map((option, optionIndex) => {
                    const label = stringParam(option.label) ?? `Option ${optionIndex + 1}`;
                    return (
                      <Button
                        key={`${id}-${label}`}
                        type="button"
                        size="sm"
                        variant={answers[id] === label ? "secondary" : "outline"}
                        className="h-7 px-2 text-[11px]"
                        onClick={() =>
                          setAnswers((current) => ({ ...current, [id]: label }))
                        }
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
              <Textarea
                value={answers[id] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [id]: event.target.value }))
                }
                className="min-h-16 rounded-lg bg-background/70 text-[12px]"
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={responding}
          onClick={() => onRespond(request, "decline", { answers: {} })}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={responding}
          onClick={submit}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}

export function codexInputFromComposer(
  text: string,
  attachments: CodexAttachment[],
): CodexUserInput[] {
  const input: CodexUserInput[] = [];
  const paths = attachments.filter(
    (attachment): attachment is Extract<CodexAttachment, { kind: "path" }> =>
      attachment.kind === "path",
  );
  if (paths.length > 0) {
    input.push({
      type: "text",
      text: [
        "Attached paths:",
        ...paths.map((attachment) => {
          const kind =
            attachment.pathKind === "folder"
              ? "folder"
              : attachment.pathKind === "file"
                ? "file"
                : "path";
          return `- ${attachment.path} (${kind})`;
        }),
      ].join("\n"),
      text_elements: [],
    });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "localImage") {
      input.push({
        type: "localImage",
        path: attachment.path,
        detail: "high",
      });
    } else if (attachment.kind === "image") {
      input.push({
        type: "image",
        url: attachment.url,
        detail: "high",
      });
    }
  }
  if (text.trim()) {
    input.push({ type: "text", text: text.trim(), text_elements: [] });
  }
  return input;
}

function normalizeThreadList(response: unknown): CodexThreadListItem[] {
  const record = asObject(response);
  const raw = Array.isArray(record.threads)
    ? record.threads
    : Array.isArray(record.data)
      ? record.data
      : [];
  return raw.flatMap((item) => {
    const session = asObject(item);
    const id = stringField(session.id);
    return id ? [{ ...session, id } as CodexThreadListItem] : [];
  });
}

async function createPathAttachment(path: string): Promise<CodexAttachment> {
  const name = basename(path);
  if (isImagePath(path)) {
    return { id: `local-image:${path}`, kind: "localImage", path, name };
  }
  const pathKind = await statPathKind(path);
  return { id: `path:${path}`, kind: "path", path, pathKind };
}

type ImageBlobPayload = {
  blob: Blob;
  name: string;
  idHint?: string;
};

type ClipboardReadResult = {
  attachments: CodexAttachment[];
  text: string | null;
};

type NativeClipboardImage = {
  dataUrl: string;
  width: number;
  height: number;
};

async function createImageAttachment(
  blob: Blob,
  name = "Pasted image",
  idHint?: string,
): Promise<CodexAttachment> {
  const url = await readAsDataURL(blob);
  return {
    id: `image:${idHint ?? name}:${blob.size}:${await hashBlobPrefix(blob)}`,
    kind: "image",
    url,
    name,
  };
}

function appendAttachment(
  current: CodexAttachment[],
  attachment: CodexAttachment,
): CodexAttachment[] {
  if (current.some((item) => item.id === attachment.id)) return current;
  return [...current, attachment];
}

async function statPathKind(path: string): Promise<"file" | "folder" | "path"> {
  try {
    const stat = await invoke<{ kind?: string }>("fs_stat", {
      path,
      workspace: currentWorkspaceEnv(),
    });
    if (stat.kind === "dir") return "folder";
    if (stat.kind === "file" || stat.kind === "symlink") return "file";
  } catch {
    // Keep the attachment as a path if metadata is unavailable.
  }
  return "path";
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function attachmentsFromClipboardData(data: DataTransfer): ImageBlobPayload[] {
  const fromItems = Array.from(data.items ?? []).flatMap((item, index) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
    const file = item.getAsFile();
    return file
      ? [{ blob: file, name: file.name || `Pasted image ${index + 1}` }]
      : [];
  });
  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files ?? []).flatMap((file) =>
    file.type.startsWith("image/")
      ? [{ blob: file, name: file.name || "Pasted image" }]
      : [],
  );
}

async function readClipboardAttachments(): Promise<ClipboardReadResult> {
  const attachments: CodexAttachment[] = [];
  const clipboard = navigator.clipboard;
  if (!clipboard) return { attachments, text: null };

  try {
    if ("read" in clipboard && typeof clipboard.read === "function") {
      const items = await clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        attachments.push(
          await createImageAttachment(blob, "Clipboard image", `clipboard:${imageType}`),
        );
      }
    }
  } catch {
    // Clipboard image reads are permission/platform dependent in WebKitGTK.
  }

  if (attachments.length === 0) {
    const nativeImage = await readNativeClipboardImage();
    if (nativeImage) attachments.push(nativeImage);
  }

  let text: string | null = null;
  try {
    if (typeof clipboard.readText === "function") {
      const value = await clipboard.readText();
      text = value.trim().length > 0 ? value : null;
    }
  } catch {
    // Text reads may be denied when the call is not considered user-initiated.
  }

  return { attachments, text };
}

async function readNativeClipboardImage(): Promise<CodexAttachment | null> {
  try {
    const image = await invoke<NativeClipboardImage | null>(
      "clipboard_read_image",
    );
    if (!image?.dataUrl) return null;
    return {
      id: `image:native-clipboard:${image.width}x${image.height}:${image.dataUrl.length}`,
      kind: "image",
      url: image.dataUrl,
      name: "Clipboard image",
    };
  } catch {
    return null;
  }
}

function hasCodexDropPayload(data: DataTransfer): boolean {
  return (
    Array.from(data.files ?? []).length > 0 ||
    Array.from(data.items ?? []).some(
      (item) =>
        item.kind === "file" ||
        item.type === "text/uri-list" ||
        item.type === "text/plain",
    ) ||
    Array.from(data.types ?? []).some(
      (type) => type === "Files" || type === "text/uri-list",
    )
  );
}

async function codexAttachmentsFromDrop(
  data: DataTransfer,
): Promise<ClipboardReadResult> {
  const attachments: CodexAttachment[] = [];

  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith("image/")) {
      attachments.push(
        await createImageAttachment(file, file.name || "Dropped image"),
      );
    }
  }

  const uriList = data.getData("text/uri-list");
  const paths = parseDroppedPaths(uriList || data.getData("text/plain"));
  for (const path of paths) {
    attachments.push(await createPathAttachment(path));
  }

  const text =
    attachments.length === 0 ? data.getData("text/plain") || null : null;
  return { attachments, text };
}

function parseDroppedPaths(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .flatMap((line) => {
      if (line.startsWith("file://")) {
        try {
          return [decodeURIComponent(new URL(line).pathname)];
        } catch {
          return [];
        }
      }
      return line.startsWith("/") ? [line] : [];
    });
}

function insertTextAtTextarea(
  current: string,
  text: string,
  textarea: HTMLTextAreaElement | null,
): string {
  if (!textarea) return current ? `${current}${text}` : text;
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? current.length;
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  requestAnimationFrame(() => {
    const position = start + text.length;
    textarea.setSelectionRange(position, position);
  });
  return next;
}

async function hashBlobPrefix(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  let hash = 0;
  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }
  return hash.toString(16);
}

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

function isAttachedPathsBlock(text: string): boolean {
  return text.trimStart().startsWith("Attached paths:\n");
}

function parseAttachedPaths(
  text: string,
): Array<{ path: string; kind: "file" | "folder" | "path" }> {
  if (!isAttachedPathsBlock(text)) return [];
  return text
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const match = line.match(/^- (.+) \((file|folder|path)\)$/);
      if (!match) return [];
      return [{ path: match[1], kind: match[2] as "file" | "folder" | "path" }];
    });
}

function sessionTitle(session: CodexThreadListItem): string {
  return (
    stringField(session.title) ??
    stringField(session.preview) ??
    `Session ${shortThreadId(session.id)}`
  );
}

function formatSessionUpdated(session: CodexThreadListItem): string {
  const value = session.updatedAt ?? session.updated_at;
  if (typeof value !== "string" && typeof value !== "number") return "Updated unknown";
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "Updated unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionSource(session: CodexThreadListItem): string {
  return (
    stringField(session.source) ??
    stringField(session.threadSource) ??
    "Codex"
  );
}

function shortThreadId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

function flattenThreadItems(turns: unknown): CodexThreadItem[] {
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((turn) => {
    if (!turn || typeof turn !== "object") return [];
    const items = (turn as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as { id?: unknown; type?: unknown };
      if (typeof record.id !== "string" || typeof record.type !== "string") {
        return [];
      }
      return [normalizeLoadedThreadItem(item as Record<string, unknown>)];
    });
  });
}

function normalizeLoadedThreadItem(record: Record<string, unknown>): CodexThreadItem {
  if (record.type === "userMessage") {
    return {
      ...(record as Extract<CodexThreadItem, { type: "userMessage" }>),
      type: "userMessage",
      id: String(record.id),
      content: normalizeUserMessageContent(record),
    };
  }
  return record as CodexThreadItem;
}

function normalizeUserMessageContent(record: Record<string, unknown>): CodexUserInput[] {
  const content = Array.isArray(record.content) ? record.content : [];
  const normalized = content.flatMap(normalizeUserInputPart);
  if (normalized.length > 0) return normalized;
  if (typeof record.message === "string" && record.message.length > 0) {
    return [{ type: "text", text: record.message, text_elements: [] }];
  }
  return [];
}

function normalizeUserInputPart(part: unknown): CodexUserInput[] {
  const record = asObject(part);
  const type = stringField(record.type);
  if ((type === "text" || type === "input_text") && typeof record.text === "string") {
    return [{ type: "text", text: record.text, text_elements: [] }];
  }
  if (type === "image" && typeof record.url === "string") {
    return [{ type: "image", url: record.url, detail: "high" }];
  }
  if (type === "localImage" && typeof record.path === "string") {
    return [{ type: "localImage", path: record.path, detail: "high" }];
  }
  if (type === "local_image" && typeof record.path === "string") {
    return [{ type: "localImage", path: record.path, detail: "high" }];
  }
  if (type === "input_image" && typeof record.image_url === "string") {
    return [{ type: "image", url: record.image_url, detail: "high" }];
  }
  return [];
}

function stringParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
