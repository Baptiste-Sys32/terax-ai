import { describe, expect, it } from "vitest";
import {
  CODEX_PERMISSION_PRESETS,
  codexApprovalResult,
  createInitialCodexChatState,
  reduceCodexEvent,
  type CodexPendingRequest,
} from "./chatState";

describe("reduceCodexEvent", () => {
  it("folds assistant deltas into one message item", () => {
    const initial = createInitialCodexChatState();
    const first = reduceCodexEvent(initial, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-1",
        delta: "Hello",
      },
    });
    const second = reduceCodexEvent(first, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-1",
        delta: " world",
      },
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      type: "agentMessage",
      id: "msg-1",
      text: "Hello world",
    });
  });

  it("folds reasoning summary and content deltas by index", () => {
    let state = createInitialCodexChatState();
    state = reduceCodexEvent(state, {
      method: "item/reasoning/summaryPartAdded",
      params: { itemId: "reasoning-1", summaryIndex: 1 },
    });
    state = reduceCodexEvent(state, {
      method: "item/reasoning/summaryTextDelta",
      params: { itemId: "reasoning-1", summaryIndex: 1, delta: "checked" },
    });
    state = reduceCodexEvent(state, {
      method: "item/reasoning/textDelta",
      params: { itemId: "reasoning-1", contentIndex: 0, delta: "detail" },
    });

    expect(state.items[0]).toMatchObject({
      type: "reasoning",
      id: "reasoning-1",
      summary: ["", "checked"],
      content: ["detail"],
    });
  });

  it("tracks and resolves server approval requests", () => {
    let state = createInitialCodexChatState();
    state = reduceCodexEvent(state, {
      kind: "serverRequest",
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", command: "npm test" },
    });

    expect(state.pendingRequests).toHaveLength(1);
    state = reduceCodexEvent(state, {
      method: "serverRequest/resolved",
      params: { threadId: "thread-1", requestId: "approval-1" },
    });
    expect(state.pendingRequests).toHaveLength(0);
  });

  it("normalizes raw completed items before rendering", () => {
    const state = reduceCodexEvent(createInitialCodexChatState(), {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-1",
          status: "completed",
          items: [
            {
              id: "files-1",
              type: "fileChange",
              status: "completed",
              changes: { path: "/home/badeparday/Downloads/example.md" },
            },
            {
              id: "reasoning-1",
              type: "reasoning",
              summary: null,
              content: "not-an-array",
            },
          ],
        },
      },
    });

    expect(state.items).toMatchObject([
      { id: "files-1", type: "fileChange", changes: [] },
      { id: "reasoning-1", type: "reasoning", summary: [], content: [] },
    ]);
  });
});

describe("codexApprovalResult", () => {
  it("builds command approval decisions", () => {
    const request: CodexPendingRequest = {
      requestId: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {},
    };

    expect(codexApprovalResult(request, "accept")).toEqual({
      decision: "accept",
    });
    expect(codexApprovalResult(request, "acceptForSession")).toEqual({
      decision: "acceptForSession",
    });
  });

  it("builds permission grant and deny payloads", () => {
    const request: CodexPendingRequest = {
      requestId: "permission-1",
      method: "item/permissions/requestApproval",
      params: { permissions: { network: { allow: ["example.com"] } } },
    };

    expect(codexApprovalResult(request, "allowSession")).toEqual({
      permissions: { network: { allow: ["example.com"] } },
      scope: "session",
    });
    expect(codexApprovalResult(request, "decline")).toEqual({
      permissions: {},
      scope: "turn",
      strictAutoReview: true,
    });
  });
});

describe("CODEX_PERMISSION_PRESETS", () => {
  it("keeps the default mode supervised and workspace-scoped", () => {
    expect(CODEX_PERMISSION_PRESETS.default).toMatchObject({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
  });

  it("only full-access disables approval prompts", () => {
    expect(CODEX_PERMISSION_PRESETS["read-only"].approvalPolicy).toBe(
      "on-request",
    );
    expect(CODEX_PERMISSION_PRESETS["full-access"].approvalPolicy).toBe("never");
  });
});
