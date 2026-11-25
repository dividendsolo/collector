"use client";

import { creditBar } from "@/lib/toasts";
import { useAi } from "./ai";
import { BlurText } from "./ui";

export function CreditBar() {
  const { data: ai } = useAi();
  const bar = creditBar(ai?.providers);
  if (!bar) return null;
  return (
    <div className="credit-bar" role="status">
      <a className="plain" href={bar.href}>
        <span className="credit-bar-long">
          <BlurText text={bar.text} />
        </span>
        <span className="credit-bar-short">
          <BlurText text={bar.short} />
        </span>
      </a>
    </div>
  );
}
