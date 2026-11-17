import { flushSync } from "react-dom";

export function transitionOut(update: () => void) {
  if (!document.startViewTransition || !CSS.supports("view-transition-group", "contain")) return update();
  document.startViewTransition(() => flushSync(update));
}

export function transitionName(prefix: string, repo: string, number: number) {
  const ident = repo.replace(/[^A-Za-z0-9-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);
  return `${prefix}-${ident}-${number}`;
}
