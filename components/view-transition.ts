import { flushSync } from "react-dom";

export function withViewTransition(update: () => void) {
  if (typeof document.startViewTransition !== "function") return update();
  document.startViewTransition(() => flushSync(update));
}
