import { describe, expect, it } from "vitest";
import {
  codexInputFromComposer,
  type CodexAttachment,
} from "./CodexChatView";

describe("codexInputFromComposer", () => {
  it("converts paths, local images, pasted images, and text into Codex input", () => {
    const attachments: CodexAttachment[] = [
      {
        id: "path:/repo/src",
        kind: "path",
        path: "/repo/src",
        pathKind: "folder",
      },
      {
        id: "local-image:/repo/diagram.png",
        kind: "localImage",
        path: "/repo/diagram.png",
        name: "diagram.png",
      },
      {
        id: "image:pasted",
        kind: "image",
        url: "data:image/png;base64,abc",
        name: "Pasted image",
      },
    ];

    expect(codexInputFromComposer("Explain this", attachments)).toEqual([
      {
        type: "text",
        text: "Attached paths:\n- /repo/src (folder)",
        text_elements: [],
      },
      { type: "localImage", path: "/repo/diagram.png", detail: "high" },
      { type: "image", url: "data:image/png;base64,abc", detail: "high" },
      { type: "text", text: "Explain this", text_elements: [] },
    ]);
  });
});
