/**
 * A toast's link (James, 2026-11-06: "they need to go to the page that it's on, and it needs to scroll down to the
 * section so they can see it easily ... consistent throughout all the toast notifications"). Every toast links to
 * `#/<page>?to=<element id>`: the page opens, glides to that element and flashes it once. The query is taken off the
 * address once read, so a refresh does not scroll again and the same link works twice in a row.
 */
export const JUMP_PARAM = "to";

export function jumpHref(page: string, id: string): string {
  return `#/${page}?${JUMP_PARAM}=${encodeURIComponent(id)}`;
}

/** The element id a hash asks to scroll to, or null. */
export function jumpTargetOf(hash: string): string | null {
  const query = hash.split("?")[1];
  if (!query) return null;
  return new URLSearchParams(query).get(JUMP_PARAM) || null;
}

/** The hash without the jump target, the rest of its query kept. */
export function withoutJump(hash: string): string {
  const [page, query] = hash.split("?");
  if (!query) return hash;
  const params = new URLSearchParams(query);
  params.delete(JUMP_PARAM);
  const rest = params.toString();
  return rest ? `${page}?${rest}` : page;
}
