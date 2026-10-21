"use client";

import { Fragment, type ReactNode, useSyncExternalStore } from "react";
import { moneyParts } from "@/lib/format";

export type IconName =
  | "logo"
  | "alert"
  | "check"
  | "play"
  | "clock"
  | "bot"
  | "term"
  | "home"
  | "dash"
  | "layers"
  | "globe"
  | "server"
  | "activity"
  | "receipt"
  | "brief"
  | "list"
  | "chev"
  | "eye"
  | "eye-off"
  | "gauge";

export const Icon = ({ name, className = "i" }: { name: IconName; className?: string }) => (
  <svg className={className} aria-hidden="true">
    <use href={`#i-${name}`} />
  </svg>
);

/** The icon sprite, once per page. */
export function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="i-logo" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </symbol>
      <symbol id="i-play" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8.5 5 3.5-5 3.5z" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </symbol>
      <symbol id="i-bot" viewBox="0 0 24 24">
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <path d="M12 4v4M9 14h.01M15 14h.01" />
      </symbol>
      <symbol id="i-term" viewBox="0 0 24 24">
        <path d="m5 8 4 4-4 4M12 16h7" />
      </symbol>
      <symbol id="i-home" viewBox="0 0 24 24">
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </symbol>
      <symbol id="i-dash" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </symbol>
      <symbol id="i-layers" viewBox="0 0 24 24">
        <path d="m12 2 9 5-9 5-9-5z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </symbol>
      <symbol id="i-globe" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </symbol>
      <symbol id="i-server" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </symbol>
      <symbol id="i-activity" viewBox="0 0 24 24">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </symbol>
      <symbol id="i-receipt" viewBox="0 0 24 24">
        <path d="M5 3v18l2-1.5L9 21l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3z" />
        <path d="M9 9h6M9 13h6" />
      </symbol>
      <symbol id="i-brief" viewBox="0 0 24 24">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" />
      </symbol>
      <symbol id="i-chev" viewBox="0 0 24 24">
        <path d="m9 6 6 6-6 6" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24">
        <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
      </symbol>
      <symbol id="i-gauge" viewBox="0 0 24 24">
        <path d="M12 14l4-4" />
        <path d="M3.3 17a9 9 0 1 1 17.4 0" />
      </symbol>
    </svg>
  );
}

export function PanelHead({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="panel-head">
      <Icon name={icon} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export const Count = ({
  n,
  hot,
  hidden,
  title,
}: {
  n: number | string;
  hot?: boolean;
  hidden?: boolean;
  title?: string;
}) => (
  <span className={`count${hot ? " hot" : ""}`} hidden={hidden} title={title}>
    {n}
  </span>
);

/** Status pill with its dot: ok, failed, warning, agent, human, or plain. */
export const Pill = ({ cls = "", dot = true, children }: { cls?: string; dot?: boolean; children: ReactNode }) => (
  <span className={`pill ${cls}`.trim()}>
    {dot && <span className="dot" />}
    {children}
  </span>
);

export const Ext = ({
  href,
  className,
  children,
  title,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) => (
  <a className={className} href={href} target="_blank" rel="noopener" title={title}>
    {children}
  </a>
);

export const Dash = () => <span className="sub">—</span>;

/** Skeleton rows: the shape of the rows to come, so nothing shifts when the data lands. */
export const SkelRows = ({ n, cols }: { n: number; cols: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <tr className="skel-row" key={i}>
        {Array.from({ length: cols }, (_, k) => (
          <td key={k}>
            <span className="skel short" />
          </td>
        ))}
      </tr>
    ))}
  </>
);
export const SkelItems = ({ n }: { n: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <li className="skel-row" key={i}>
        <div>
          <span className="skel w1" />
          <span className="skel w2" />
        </div>
        <span className="skel w3" />
      </li>
    ))}
  </>
);
export const SkelStat = ({ bar }: { bar?: boolean }) => (
  <div className="stat">
    <span className="skel short" />
    <span className="skel w1" style={{ height: 20 }} />
    {bar && <div className="bar" />}
  </div>
);
export const SkelPlans = () => (
  <>
    {[0, 1].map((i) => (
      <div className="plan skel-row" key={i}>
        <div className="plan-head">
          <span className="skel w1" />
        </div>
        <div className="stats">
          <SkelStat bar />
          <SkelStat bar />
        </div>
      </div>
    ))}
  </>
);

// ---- Blur toggle for amounts: one switch for every eye button, remembered in this browser only.

const blurSubs = new Set<() => void>();
function readBlur() {
  try {
    return localStorage.getItem("collector.blurMoney") === "1";
  } catch {
    return false;
  }
}
let blurOn: boolean | null = null;
export function setBlur(on: boolean) {
  blurOn = on;
  document.body.classList.toggle("blur-money", on);
  try {
    localStorage.setItem("collector.blurMoney", on ? "1" : "0");
  } catch {}
  for (const f of blurSubs) f();
}
const getBlur = () => {
  if (blurOn === null) {
    blurOn = readBlur();
    document.body.classList.toggle("blur-money", blurOn);
  }
  return blurOn;
};
const subBlur = (f: () => void) => {
  blurSubs.add(f);
  return () => {
    blurSubs.delete(f);
  };
};

export function BlurToggle() {
  const on = useSyncExternalStore(subBlur, getBlur, () => false);
  return (
    <button
      className="blur-toggle"
      type="button"
      aria-pressed={on}
      title={on ? "Show the amounts" : "Blur the amounts"}
      onClick={() => setBlur(!on)}
    >
      <Icon name={on ? "eye-off" : "eye"} />
    </button>
  );
}

export const Money = ({ children }: { children: ReactNode }) => <span className="money">{children}</span>;

/** A sentence whose dollar amounts blur with the eye button too. */
export const BlurText = ({ text }: { text: string }) => (
  <>
    {moneyParts(text).map((p, i) =>
      p.money ? <Money key={i}>{p.text}</Money> : <Fragment key={i}>{p.text}</Fragment>,
    )}
  </>
);
