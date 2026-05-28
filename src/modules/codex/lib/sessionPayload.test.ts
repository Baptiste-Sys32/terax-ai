import { describe, expect, it } from "vitest";
import {
  formatSessionUpdatedMs,
  normalizeThreadListPayload,
  shortThreadId,
} from "./sessionPayload";

describe("normalizeThreadListPayload", () => {
  it("normalizes threads payloads into stable session rows", () => {
    expect(
      normalizeThreadListPayload({
        threads: [
          {
            id: "thread-1234567890",
            title: "Fix build",
            preview: "Investigated AppImage",
            cwd: "/repo",
            source: "user",
            updated_at: 1_700_000_000,
          },
        ],
      }),
    ).toMatchObject([
      {
        id: "thread-1234567890",
        title: "Fix build",
        preview: "Investigated AppImage",
        cwd: "/repo",
        source: "user",
        updatedAtMs: 1_700_000_000_000,
      },
    ]);
  });

  it("accepts data payloads and fallback fields", () => {
    expect(
      normalizeThreadListPayload({
        data: [
          {
            id: "abc",
            summary: "Preview text",
            workingDirectory: "/tmp",
            threadSource: "terax",
            updatedAt: "2026-05-28T10:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject([
      {
        id: "abc",
        title: "Preview text",
        preview: "Preview text",
        cwd: "/tmp",
        source: "terax",
        updatedAtMs: Date.parse("2026-05-28T10:00:00.000Z"),
      },
    ]);
  });

  it("drops rows without usable ids", () => {
    expect(normalizeThreadListPayload({ threads: [{ title: "No id" }] })).toEqual(
      [],
    );
  });
});

describe("session display helpers", () => {
  it("shortens long thread ids", () => {
    expect(shortThreadId("thread-1234567890")).toBe("thread...7890");
  });

  it("formats missing updated timestamps explicitly", () => {
    expect(formatSessionUpdatedMs(null)).toBe("Updated unknown");
  });
});
