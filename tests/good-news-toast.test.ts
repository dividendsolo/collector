import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { noticeToasts, sortToasts, type Toast } from "@/lib/toasts";

const acks = vi.hoisted(() => ({ list: [] as string[], setAck: vi.fn() }));
const read = vi.hoisted(() => ({ machines: [] as unknown[], services: [] as unknown[], github: null as unknown }));

vi.mock("@/components/acks", () => ({ useAcks: () => acks.list, setAck: acks.setAck }));
vi.mock("@/components/data", () => ({
  useLive: () => ({ state: { at: 0, github: read.github, machines: read.machines } }),
}));
vi.mock("@/components/services", () => ({ useServices: () => read.services }));
vi.mock("@/components/ai", () => ({ useAi: () => ({ data: null }) }));

const { Toasts } = await import("@/components/toasts");

const notice = {
  key: "listing:app-rater",
  level: "info",
  text: "Situation is listed on App Rater",
  href: "https://example.com/app-rater",
};

const machine = (level = "info") => ({ name: "ezio", notices: [{ ...notice, level }] });

const draw = () => renderToStaticMarkup(createElement(Toasts));

const reset = () => {
  read.machines = [];
  read.services = [];
  read.github = null;
};

const src = readFileSync(path.join(process.cwd(), "components", "toasts.tsx"), "utf8");

describe("a good-news toast (collector#180)", () => {
  it("renders blue, with no dot and a Dismiss button", () => {
    reset();
    read.machines = [machine()];
    const html = draw();
    expect(html).toContain('class="toast good no-dot"');
    expect(html).not.toContain("toast-dot");
    expect(html).toContain('role="status"');
    expect(html).toContain(">Dismiss</button>");
    expect(html).toContain("Situation is listed on App Rater");
  });

  it("acknowledges the notice's key when its Dismiss fades out, so the toast and its row both go", () => {
    expect(src).toMatch(/if \(t\.acknowledges\) setAck\(t\.key, true\);\s*else dismiss\(t\.key, t\.state\);/);
    expect(src).toMatch(/onClick=\{\(\) => setDismissing\(/);
    expect(src).toMatch(/onTransitionEnd/);
    expect(noticeToasts([machine()], [notice.key])).toEqual([]);
  });

  it("keeps an error notice red, with its dot and no Dismiss", () => {
    reset();
    read.machines = [machine("error")];
    const html = draw();
    expect(html).toContain('class="toast error"');
    expect(html).toContain("toast-dot");
    expect(html).not.toContain("Dismiss");
  });

  it("leaves a warning toast as it was: the warn class, the dot, and its own Dismiss where it had one", () => {
    reset();
    read.services = [{ name: "Example", url: "https://example.com", status: "slow", error: null }];
    const slow = draw();
    expect(slow).toContain('class="toast warn"');
    expect(slow).toContain("toast-dot");
    expect(slow).not.toContain("Dismiss");
    reset();
    read.github = { core: { used: 5000, limit: 5000, reset: 100 } };
    const limit = draw();
    expect(limit).toContain('class="toast warn"');
    expect(limit).toContain("toast-dot");
    expect(limit).toContain(">Dismiss</button>");
  });

  it("stacks after errors and warnings", () => {
    const warn: Toast = { key: "w", state: "s", level: "warn", title: "w", text: "", href: "#" };
    const error: Toast = { ...warn, key: "e", level: "error" };
    expect(sortToasts([noticeToasts([machine()])[0], warn, error]).map((t) => t.level)).toEqual([
      "error",
      "warn",
      "good",
    ]);
  });

  it("draws a blue border, from the blue both themes define", () => {
    const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.toast\.good \{\s*border-color: var\(--blue\);/);
    const [dark, light] = css.split(":root.light {");
    expect(dark).toMatch(/--blue:\s*oklch/);
    expect(light).toMatch(/--blue:\s*oklch/);
  });
});
