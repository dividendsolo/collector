"use client";

import { useEffect, useRef, useState } from "react";

const TIP = ".card-tip, [data-tip]";
type Card = { title: string; text: string; url: string } | null;
const cache = new Map<string, Promise<Card>>();

/** Card tooltip: hover or focus a card number to see what the card is for (title + its Summary or What).
 * Any element with data-tip (a Projects row) shows that text instead, with data-tip-title above it. */
export function CardTip() {
  const tip = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<{ key: string; card?: Card; loading: boolean } | null>(null);
  const forKey = useRef<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const place = () => {
      const el = anchor.current;
      const t = tip.current;
      if (!el || !t) return;
      const r = el.getBoundingClientRect();
      const w = t.offsetWidth;
      const h = t.offsetHeight;
      t.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
      t.style.top = `${r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
    };
    const show = async (el: HTMLElement) => {
      const key = el.dataset.tip ? `tip:${el.dataset.tip}` : `${el.dataset.repo}#${el.dataset.card}`;
      if (forKey.current === key) return;
      forKey.current = key;
      anchor.current = el;
      if (el.dataset.tip) {
        setBody({ key, card: { title: el.dataset.tipTitle || "", text: el.dataset.tip, url: "" }, loading: false });
        requestAnimationFrame(place);
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
      requestAnimationFrame(place);
      const c = await cache.get(key);
      if (forKey.current !== key) return;
      if (!c) cache.delete(key); // try again on the next hover
      setBody({ key, card: c, loading: false });
      requestAnimationFrame(place);
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
    <div id="card-tip" ref={tip} role="tooltip" hidden={!body}>
      {body?.loading ? (
        <span>Loading the card…</span>
      ) : body?.card ? (
        <>
          <strong>{body.card.title}</strong>
          {body.card.text ? <span>{body.card.text}</span> : null}
        </>
      ) : body ? (
        <span>Could not read {body.key}.</span>
      ) : null}
    </div>
  );
}
