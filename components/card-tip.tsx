"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const TIP = ".card-tip, [data-tip]";
type Fact = [label: string, value: string];
type Card = { title: string; text: string; url: string; facts?: Fact[]; tone?: string } | null;

function factsOf(el: HTMLElement): Fact[] | undefined {
  if (!el.dataset.tipFacts) return undefined;
  try {
    const f = JSON.parse(el.dataset.tipFacts);
    return Array.isArray(f) ? f.filter((x) => Array.isArray(x) && x.length === 2) : undefined;
  } catch {
    return undefined;
  }
}
const cache = new Map<string, Promise<Card>>();

export function CardTip() {
  const tip = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<{ key: string; card?: Card; loading: boolean } | null>(null);
  const forKey = useRef<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = anchor.current;
    const t = tip.current;
    if (!body || !el || !t) return;
    const r = el.getBoundingClientRect();
    t.style.left = "0px";
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    t.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    t.style.top = `${r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
  }, [body]);

  useEffect(() => {
    const show = async (el: HTMLElement) => {
      const key =
        el.dataset.tip || el.dataset.tipFacts
          ? `tip:${el.dataset.tipTitle}:${el.dataset.tip}:${el.dataset.tipFacts}:${el.dataset.tipTone}`
          : `${el.dataset.repo}#${el.dataset.card}`;
      if (forKey.current === key) return;
      forKey.current = key;
      anchor.current = el;
      if (el.dataset.tip || el.dataset.tipFacts) {
        setBody({
          key,
          card: {
            title: el.dataset.tipTitle || "",
            text: el.dataset.tip || "",
            url: "",
            facts: factsOf(el),
            tone: el.dataset.tipTone,
          },
          loading: false,
        });
        return;
      }
      if (!cache.has(key))
        cache.set(
          key,
          fetch(
            `/api/card?repo=${encodeURIComponent(el.dataset.repo || "")}&n=${encodeURIComponent(el.dataset.card || "")}`,
          )
            .then((r) => r.json())
            .catch(() => null),
        );
      setBody({ key, loading: true });
      const c = await cache.get(key);
      if (forKey.current !== key) return;
      if (!c) cache.delete(key);
      setBody({ key, card: c, loading: false });
    };
    const hide = () => {
      forKey.current = null;
      anchor.current = null;
      setBody(null);
    };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement).closest?.(TIP) as HTMLElement | null;
      if (el) show(el);
    };
    const out = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.(TIP) && !(e.relatedTarget as HTMLElement | null)?.closest?.(TIP)) hide();
    };
    const fout = (e: Event) => {
      if ((e.target as HTMLElement).closest?.(TIP)) hide();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", fout);
    document.documentElement.addEventListener("mouseleave", hide);
    addEventListener("blur", hide);
    addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", fout);
      document.documentElement.removeEventListener("mouseleave", hide);
      removeEventListener("blur", hide);
      removeEventListener("scroll", hide);
    };
  }, []);

  return (
    <div
      id="card-tip"
      ref={tip}
      role="tooltip"
      hidden={!body}
      className={body?.card?.tone ? `tone-${body.card.tone}` : undefined}
    >
      {body?.loading ? (
        <span>Loading the card…</span>
      ) : body?.card ? (
        <>
          <strong>{body.card.title}</strong>
          {body.card.text ? <span>{body.card.text}</span> : null}
          {body.card.facts?.length ? (
            <div className="tip-facts">
              {body.card.facts.map(([label, value], i) => (
                <div key={`${i}-${label}`}>
                  <span className="tip-label">{label}:</span> <span className="tip-value">{value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : body ? (
        <span>Could not read {body.key}.</span>
      ) : null}
    </div>
  );
}
