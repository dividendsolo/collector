export const JUMP_PARAM = "to";

export function jumpHref(page: string, id: string): string {
  return `#/${page}?${JUMP_PARAM}=${encodeURIComponent(id)}`;
}

export function jumpTargetOf(hash: string): string | null {
  const query = hash.split("?")[1];
  if (!query) return null;
  return new URLSearchParams(query).get(JUMP_PARAM) || null;
}

export function withoutJump(hash: string): string {
  const [page, query] = hash.split("?");
  if (!query) return hash;
  const params = new URLSearchParams(query);
  params.delete(JUMP_PARAM);
  const rest = params.toString();
  return rest ? `${page}?${rest}` : page;
}
