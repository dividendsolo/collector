/** shadcn/ui's class joiner, without the tailwind-merge dependency: Collector's classes never conflict. */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
