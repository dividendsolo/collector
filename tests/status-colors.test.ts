import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_COLOR, statusPill } from "@/lib/status-colors";
import { AGENT_STACK_ALL } from "@/lib/statuses";

const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");

describe("status pills take the Big Board's Status colors (James, 2026-11-23)", () => {
  it("matches the colors GitHub shows for each status", () => {
    expect(BOARD_COLOR).toEqual({
      "needs-manual-qa": "red",
      "needs-info": "yellow",
      "needs-triage": "yellow",
      "ready-for-human": "green",
      scheduled: "blue",
      "ready-for-agent": "green",
      "changes-requested": "orange",
      "agent-in-progress": "orange",
      "code-review": "blue",
      "ready-to-merge": "green",
      merging: "purple",
    });
  });

  it("gives code-review a blue pill and ready-to-merge a green one", () => {
    expect(statusPill("code-review")).toBe("board-blue");
    expect(statusPill("ready-to-merge")).toBe("board-green");
    expect(statusPill("merging")).toBe("board-purple");
  });

  it("leaves a status the board gives no color plain", () => {
    expect(statusPill("closed")).toBe("");
    expect(statusPill("blocked")).toBe("");
  });

  it("knows only real statuses", () => {
    for (const s of Object.keys(BOARD_COLOR)) expect(AGENT_STACK_ALL).toContain(s);
  });

  it("styles every board color", () => {
    for (const c of new Set(Object.values(BOARD_COLOR))) expect(css).toContain(`.pill.board-${c}`);
  });
});
