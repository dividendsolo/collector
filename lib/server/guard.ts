import { json } from "@/lib/server/respond";

export function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  const end = h.indexOf("]");
  if (h.startsWith("[")) return (end === -1 ? h.slice(1) : h.slice(1, end)).replace(/\.$/, "");
  const colon = h.lastIndexOf(":");
  const name = colon === -1 || h.slice(0, colon).includes(":") ? h : h.slice(0, colon);
  return name.replace(/\.$/, "");
}

const LOOPBACK_V4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isLoopbackV4 = (name: string) => {
  const octets = LOOPBACK_V4.exec(name);
  return !!octets && octets.slice(1).every((part) => Number(part) <= 255);
};

export const isLoopbackHost = (host: string): boolean => {
  const name = hostName(host);
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    name === "0:0:0:0:0:0:0:1" ||
    isLoopbackV4(name)
  );
};

const requestHost = (req: Request, url: URL) => req.headers.get("host") || url.host;

export function fromAnotherSite(req: Request, url: URL): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== requestHost(req, url);
  } catch {
    return true;
  }
}

export function guard(req: Request): Response | null {
  const url = new URL(req.url);
  if (!isLoopbackHost(requestHost(req, url)))
    return json({ why: "Collector answers only on this machine's own address (127.0.0.1 or localhost)" }, 403);
  if (req.method !== "GET" && req.method !== "HEAD" && fromAnotherSite(req, url))
    return json({ why: "a write comes from this page only" }, 403);
  return null;
}
