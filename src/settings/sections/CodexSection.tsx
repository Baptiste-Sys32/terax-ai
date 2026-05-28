import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  codexAccountCreate,
  codexDebugStatus,
  codexLoginCancel,
  codexLoginStart,
  codexLogout,
  codexStatus,
  listenCodexEvents,
  type CodexAccount,
  type CodexDebugStatus,
  type CodexLoginStartResponse,
  type CodexStatus,
} from "@/modules/codex";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ComputerTerminal02Icon,
  Copy01Icon,
  Login01Icon,
  Logout01Icon,
  Folder01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function CodexSection() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<CodexDebugStatus | null>(null);
  const [pendingLogin, setPendingLogin] =
    useState<CodexLoginStartResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, nextDebug] = await Promise.all([
        codexStatus(),
        codexDebugStatus().catch(() => null),
      ]);
      setStatus(next);
      setDebug(nextDebug);
      setError(next.detail ?? null);
      if (next.account) setPendingLogin(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenCodexEvents((event) => {
      if (disposed) return;
      if (
        event.method === "account/updated" ||
        event.method === "account/login/completed"
      ) {
        if (event.method === "account/login/completed") setPendingLogin(null);
        void refresh();
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  const accountText = useMemo(
    () => formatAccount(status?.account ?? null),
    [status?.account],
  );

  const startLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const flow = await codexLoginStart();
      setPendingLogin(flow);
      if (flow.kind === "browser") {
        await openUrl(flow.authUrl);
      } else {
        await openUrl(flow.verificationUrl);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const loginAnother = async () => {
    setBusy(true);
    setError(null);
    try {
      await codexAccountCreate();
      setBusy(false);
      await startLogin();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const cancelLogin = async () => {
    if (!pendingLogin) return;
    setBusy(true);
    setError(null);
    try {
      await codexLoginCancel(pendingLogin.loginId);
      setPendingLogin(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      await codexLogout();
      setPendingLogin(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const installed = status?.installed === true;
  const loggedIn = !!status?.account;

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Codex"
        description="Connect the local Codex CLI account for the native Codex chat tab."
      />

      <section className="flex flex-col gap-2">
        <SettingRow
          title="CLI"
          description={
            status?.version
              ? `Detected ${status.version}`
              : "Terax looks for the local Codex CLI before starting login."
          }
        >
          <div className="flex items-center gap-2">
            <StatusBadge ok={installed} label={installed ? "Installed" : "Missing"} />
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => void refresh()}
              title="Refresh"
              disabled={busy}
            >
              <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={1.75} />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title="Account"
          description={accountText.detail}
        >
          <StatusBadge ok={loggedIn} label={loggedIn ? "Signed in" : "Signed out"} />
        </SettingRow>

        <SettingRow
          title="Debug"
          description={
            debug
              ? `Home ${debug.activeAccountHome}`
              : "Codex bridge diagnostics are loaded on refresh."
          }
        >
          <StatusBadge
            ok={debug?.appServerHealthy === true}
            label={debug?.appServerHealthy ? "App-server live" : "App-server idle"}
          />
        </SettingRow>

        {debug ? (
          <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
            <div className="grid gap-1.5 text-[11px] leading-relaxed">
              <DebugLine label="Codex home" value={debug.codexHome} />
              <DebugLine
                label="Profile"
                value={`${debug.activeAccountLabel} (${debug.activeAccountId})`}
              />
              <DebugLine
                label="CLI"
                value={debug.cliVersion ?? debug.codexBin ?? "Not detected"}
              />
              <DebugLine
                label="Bridge error"
                value={debug.lastBridgeError ?? "None"}
              />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => void navigator.clipboard?.writeText(debug.activeAccountHome)}
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.75} />
                Copy home
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => void revealItemInDir(debug.activeAccountHome)}
              >
                <HugeiconsIcon icon={Folder01Icon} size={12} strokeWidth={1.75} />
                Open folder
              </Button>
            </div>
          </div>
        ) : null}

        {pendingLogin ? (
          <PendingLoginRow flow={pendingLogin} onCancel={cancelLogin} busy={busy} />
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {loggedIn ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => void loginAnother()}
                disabled={!installed || busy || !!pendingLogin}
              >
                <HugeiconsIcon icon={Login01Icon} size={12} strokeWidth={1.75} />
                Login another
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => void logout()}
                disabled={!installed || busy}
              >
                <HugeiconsIcon icon={Logout01Icon} size={12} strokeWidth={1.75} />
                Logout
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => void startLogin()}
              disabled={!installed || busy || !!pendingLogin}
            >
              <HugeiconsIcon icon={Login01Icon} size={12} strokeWidth={1.75} />
              Login
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function PendingLoginRow({
  flow,
  onCancel,
  busy,
}: {
  flow: CodexLoginStartResponse;
  onCancel: () => void;
  busy: boolean;
}) {
  const isDevice = flow.kind === "device";
  const url = isDevice ? flow.verificationUrl : flow.authUrl;

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex min-w-0 gap-2">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40">
          <HugeiconsIcon
            icon={isDevice ? ComputerTerminal02Icon : ArrowUpRight01Icon}
            size={14}
            strokeWidth={1.5}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12.5px] font-medium">
            {isDevice ? "Device login pending" : "Browser login pending"}
          </span>
          <span className="truncate text-[10.5px] text-muted-foreground">
            {url}
          </span>
          {isDevice ? (
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-muted/60 px-2 py-1 font-mono text-[12px]">
                {flow.userCode}
              </code>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Copy code"
                onClick={() => void navigator.clipboard?.writeText(flow.userCode)}
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.75} />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 px-2 text-[11px]"
        onClick={onCancel}
        disabled={busy}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        Cancel
      </Button>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant={ok ? "secondary" : "outline"}
      className="gap-1.5 text-[10.5px]"
    >
      {ok ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={1.75} />
      ) : null}
      {label}
    </Badge>
  );
}

function DebugLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

function formatAccount(account: CodexAccount | null): { detail: string } {
  if (!account) return { detail: "No Codex account is active." };
  if (account.type === "chatgpt") {
    const plan = "planType" in account ? account.planType : null;
    const suffix = plan ? ` (${String(plan)})` : "";
    return { detail: `${account.email}${suffix}` };
  }
  if (account.type === "apiKey") {
    return { detail: "Signed in with an OpenAI API key managed by Codex." };
  }
  return { detail: `Signed in with ${String(account.type)}.` };
}
