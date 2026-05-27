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
  codexAppRespond,
  codexModelList,
  codexStatus,
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
import {
  AiBrain04Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ComputerTerminal02Icon,
  File01Icon,
  Loading03Icon,
  LockIcon,
  Settings01Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FormEvent,
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

const DEFAULT_CODEX_MODEL = "gpt-5.5";
const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";
const CODEX_SLASH_COMMANDS = [
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
  | { type: "thread-started"; threadId: string; items?: CodexThreadItem[] }
  | { type: "turn-started"; turnId: string; items?: CodexThreadItem[] }
  | { type: "error"; message: string }
  | { type: "resolved"; requestId: string | number };

function chatReducer(state: CodexChatState, action: LocalAction): CodexChatState {
  if (action.type === "event") return reduceCodexEvent(state, action.event);
  if (action.type === "thread-started") {
    return {
      ...state,
      threadId: action.threadId,
      status: "running",
      error: null,
      items: action.items
        ? mergeThreadItems(state.items, action.items)
        : state.items,
    };
  }
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
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_CODEX_MODEL);
  const [effort, setEffort] = useState<CodexReasoningEffort>(
    DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [permissionMode, setPermissionMode] =
    useState<CodexPermissionMode>("default");
  const [prompt, setPrompt] = useState("");
  const [slashNotice, setSlashNotice] = useState<string | null>(null);
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

  const runLocalSlashCommand = useCallback(
    (text: string): boolean => {
      const command = text.trim().toLowerCase();
      if (command === "/status") {
        const model = selectedModelInfo?.displayName ?? formatGptModelName(selectedModel);
        const account = status?.account
          ? formatAccountDetail(status.account)
          : "Signed out";
        setSlashNotice(
          `Status: ${installed ? "Codex CLI connected" : "Codex CLI missing"} · ${account} · ${model} · ${REASONING_LABELS[effort] ?? effort} · ${CODEX_PERMISSION_PRESETS[permissionMode].label}`,
        );
        setPrompt("");
        return true;
      }
      if (command === "/model") {
        const model = selectedModelInfo?.displayName ?? formatGptModelName(selectedModel);
        setSlashNotice(
          `Model: ${model}. Use the model picker in the composer to switch models.`,
        );
        setPrompt("");
        return true;
      }
      if (command === "/help") {
        setSlashNotice(
          `Commands: ${CODEX_SLASH_COMMANDS.map((item) => item.invocation).join(", ")}`,
        );
        setPrompt("");
        return true;
      }
      return false;
    },
    [
      effort,
      installed,
      permissionMode,
      selectedModel,
      selectedModelInfo?.displayName,
      status?.account,
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
      } catch (error) {
        dispatch({ type: "error", message: String(error) });
      } finally {
        setLoadingModels(false);
      }
    },
    [loadModels, status?.activeAccountId],
  );

  const submitPrompt = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = prompt.trim();
      if (!text || sending) return;
      if (runLocalSlashCommand(text)) return;
      if (!installed || !loggedIn) {
        void openSettingsWindow("codex");
        return;
      }

      const preset = CODEX_PERMISSION_PRESETS[permissionMode];
      setSending(true);
      setSlashNotice(null);
      setPrompt("");
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
            items: flattenThreadItems(started.thread.turns),
          });
        }

        const turn = await codexTurnStart({
          threadId,
          text,
          cwd: tab.cwd,
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
      runLocalSlashCommand,
      selectedModelInfo?.model,
      sending,
      tab.cwd,
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
          {slashNotice ? (
            <div className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
              {slashNotice}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur">
        <form onSubmit={submitPrompt} className="mx-auto w-full max-w-208">
          <div className="rounded-[22px] p-px transition-colors focus-within:bg-ring/30">
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
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
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
                  }}
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

              <div className="flex min-w-0 items-center justify-between gap-2 px-2.5 pb-2.5">
                <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <ModelSelect
                    models={models}
                    value={selectedModel}
                    disabled={!loggedIn || loadingModels}
                    onChange={setSelectedModel}
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
                      !prompt.trim() ||
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

function ModelSelect({
  models,
  value,
  disabled,
  onChange,
}: {
  models: CodexModel[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = models.find((model) => model.model === value) ?? null;
  const selectedLabel = selected?.displayName ?? formatGptModelName(value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
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
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
    return (
      <Message from="user">
        <MessageContent>
          <p className="whitespace-pre-wrap wrap-break-word">{text}</p>
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

function flattenThreadItems(turns: unknown): CodexThreadItem[] {
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((turn) => {
    if (!turn || typeof turn !== "object") return [];
    const items = (turn as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as { id?: unknown; type?: unknown };
      return typeof record.id === "string" && typeof record.type === "string"
        ? [item as CodexThreadItem]
        : [];
    });
  });
}

function stringParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
