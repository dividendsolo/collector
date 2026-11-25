import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/components/data", () => ({ useLive: () => live.data }));

const { CurrentWork } = await import("@/components/running");

const card = (number: number, lane: string, hold: any = null) => ({
  repo: "agent-stack",
  number,
  title: `Card ${number}`,
  url: `https://github.com/dividendsolo/agent-stack/issues/${number}`,
  lane,
  priority: "P2",
  created: "2026-11-17T17:55:44Z",
  labels: [],
  hold,
});

const later = { after: [], from: "2026-11-27", why: "count needs two full UTC days", to: "ready-for-agent" };

const agent = (repo: string, n: number, seconds: number) => ({
  type: "agent",
  name: `${repo}-builder`,
  kind: "build",
  model: "deepseek-v4.1-flash",
  repo,
  card: n,
  seconds,
});

const draw = () => {
  live.data = {
    state: {
      at: 0,
      machines: [
        { name: "altair", running: [agent("zero-phase", 752, 480)] },
        { name: "ezio", running: [agent("rep-sheet", 487, 60), agent("agent-stack", 544, 60)] },
      ],
    },
    board: {
      work: {
        loaded: true,
        closed: [],
        cards: [
          card(475, "scheduled", later),
          card(475, "scheduled", later),
          card(475, "scheduled", later),
          card(544, "code-review"),
        ],
      },
      tickets: { each: [], working: ["agent-in-progress", "verify-in-progress"] },
    },
  };
  return renderToStaticMarkup(createElement(CurrentWork));
};

const rows = (html: string) =>
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => m[1])
    .filter((r) => r.includes("<td"))
    .map((r) => (r.includes("scheduled") ? "scheduled" : "agent"));

describe("Current work order (2026-11-25, agent-stack#475 three times above busy agents)", () => {
  it("draws each card once, every busy agent above every scheduled card", () => {
    const order = rows(draw());
    expect(order.filter((r) => r === "scheduled")).toHaveLength(1);
    expect(order.lastIndexOf("agent")).toBeLessThan(order.indexOf("scheduled"));
  });
});
