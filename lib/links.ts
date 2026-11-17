const WEB_SCHEMES = ["http://", "https://"];

export function webUrl(url: unknown): string | undefined {
  const s = typeof url === "string" ? url.trim() : "";
  return WEB_SCHEMES.some((scheme) => s.toLowerCase().startsWith(scheme)) ? s : undefined;
}
