import { flushSync } from "react-dom";

export function transitionOut(update: () => void) {
  if (!document.startViewTransition) return update();
  document.startViewTransition(() => flushSync(update));
}
