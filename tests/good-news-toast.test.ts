import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { noticeToasts, sortToasts, type Toast } from "@/lib/toasts";

const acks = vi.hoisted(() => ({ setAck: vi.fn() }));
vi.mock("@/components/acks", () => ({ useAcks: () => [], setAck: acks.setAck }));

const { ToastCard } = await import("@/components/toasts");

const machine = {
  name: "ezio",
  notices: [
    {
      key: "listing:app-rater",
      level: "info",
      text: "Situation is listed on App Rater",
      href: "https://example.com/app-rater",
    },
  ],
};

const good = () => noticeToasts([machine])[0];

function findButton(node: unknown): ReactElement<{ onClick: () => void; children: string }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findButton(n);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === "button") return el as ReactElement<{ onClick: () => void; children: string }>;
  return findButton(el.props?.children);
}

describe("a good-news toast (collector#180)", () => {
  it("renders blue, with no dot and a Dismiss button", () => {
    const html = renderToStaticMarkup(createElement(ToastCard, { t: good() }));
    expect(html).toContain('class="toast good no-dot"');
    expect(html).not.toContain("toast-dot");
    expect(html).toContain('role="status"');
    expect(html).toContain(">Dismiss</button>");
  });

  it("acknowledges the notice's key on Dismiss, so the toast and its row both go", () => {
    const t = good();
    const button = findButton((ToastCard as (p: { t: Toast }) => ReactElement)({ t }));
    expect(button?.props.children).toBe("Dismiss");
    button?.props.onClick();
    expect(acks.setAck).toHaveBeenCalledWith("listing:app-rater", true);
    expect(noticeToasts([machine], ["listing:app-rater"])).toEqual([]);
  });

  it("sorts after errors and warnings", () => {
    const warn: Toast = { key: "w", state: "s", level: "warn", title: "w", text: "", href: "#" };
    const error: Toast = { ...warn, key: "e", level: "error" };
    expect(sortToasts([good(), warn, error]).map((t) => t.level)).toEqual(["error", "warn", "good"]);
  });

  it("keeps an error notice an error, with its dot and no Dismiss", () => {
    const [t] = noticeToasts([{ name: "ezio", notices: [{ ...machine.notices[0], level: "error" }] }]);
    const html = renderToStaticMarkup(createElement(ToastCard, { t }));
    expect(html).toContain('class="toast error"');
    expect(html).toContain("toast-dot");
    expect(html).not.toContain("Dismiss");
  });

  it("leaves a warning toast as it was: the warn class, its dot and its own Dismiss", () => {
    const warn: Toast = {
      key: "service:https://example.com",
      state: "slow",
      level: "warn",
      title: "Example is Slow",
      text: "example.com",
      href: "#/services?to=service:https://example.com",
      dismissible: true,
    };
    const html = renderToStaticMarkup(createElement(ToastCard, { t: warn }));
    expect(html).toContain('class="toast warn"');
    expect(html).toContain("toast-dot");
    expect(html).toContain(">Dismiss</button>");
  });

  it("draws a blue border, from the blue both themes define", () => {
    const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(/\.toast\.good\s*\{\s*border-color:\s*var\(--blue\);/);
    const [dark, light] = css.split(":root.light {");
    expect(dark).toMatch(/--blue:\s*oklch/);
    expect(light).toMatch(/--blue:\s*oklch/);
  });
});
