import { json } from "@/lib/server/respond";

/**
 * The one guard (collector#69): every route answers only a request that came to this machine's own address, and a
 * write only one that came from this machine's own page.
 *
 * Collector listens on 127.0.0.1, which keeps other machines out but not the browser James is already using. A page
 * he has open can post to this server from any site: a form post needs no preflight, so nothing stops it, and
 * `/api/hermes` and `/api/tailscale` take no body — one cross-site post starts the gateway or the tailnet. And a page whose own name resolves to 127.0.0.1
 * (DNS rebinding) reaches the GET routes with no check to stop it either.
 *
 * `guard(req)` answers `null` to let the request through, or the 403 to return instead. It reads the method itself,
 * so one call covers both rules, and every route calls it first:
 *
 * - the `Host` must be a loopback name — a browser sends the name it was given, so a rebinding page sends its own,
 *   and a request to this machine's address sends `127.0.0.1` or `localhost`;
 * - anything that is not `GET`/`HEAD` must come from this page: `Sec-Fetch-Site` says `same-origin`, or, where the
 *   browser sends none, the `Origin`'s host is this one. No such header at all is not a browser: a shell or an agent
 *   is answered as it always was.
 */

/** The name a Host header carries, without its port: `[::1]:4000` and `::1` read `::1`, `127.0.0.1:4000` reads
 * `127.0.0.1`. A trailing dot is the same name (`localhost.` is `localhost`: a resolver reads the two alike, and a
 * browser sends the dot when the name was typed that way), so it goes too. */
export function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  const end = h.indexOf("]");
  if (h.startsWith("[")) return (end === -1 ? h.slice(1) : h.slice(1, end)).replace(/\.$/, "");
  const colon = h.lastIndexOf(":");
  const name = colon === -1 || h.slice(0, colon).includes(":") ? h : h.slice(0, colon); // no port, or a bare IPv6
  return name.replace(/\.$/, "");
}

/** IPv4 loopback is the whole 127/8, not only 127.0.0.1 — and an octet over 255 is no address at all. */
const LOOPBACK_V4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isLoopbackV4 = (name: string) => {
  const octets = LOOPBACK_V4.exec(name);
  return !!octets && octets.slice(1).every((part) => Number(part) <= 255);
};

/** The names this machine's Collector is reached by: it serves loopback only, so its page always arrives under one of
 * these. Any other name is another machine's — or a page's own name, which is what a rebinding read sends. */
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

/** The host this request names: the header a browser sends, else the URL (a test's or an agent's `Request` carries no
 * Host header, and its URL is what says where it goes). */
const requestHost = (req: Request, url: URL) => req.headers.get("host") || url.host;

/** True when a browser says the request comes from a page of another site: `Sec-Fetch-Site` other than
 * `same-origin` (this page) or `none` (typed in the address bar), or, where the browser sends no such header, an
 * `Origin` whose host is not this one. */
export function fromAnotherSite(req: Request, url: URL): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== requestHost(req, url);
  } catch {
    return true; // an Origin that does not parse is not this page's
  }
}

/** `null` to answer the request, or the 403 to return instead. Every route calls this first. */
export function guard(req: Request): Response | null {
  const url = new URL(req.url);
  if (!isLoopbackHost(requestHost(req, url)))
    return json({ why: "Collector answers only on this machine's own address (127.0.0.1 or localhost)" }, 403);
  if (req.method !== "GET" && req.method !== "HEAD" && fromAnotherSite(req, url))
    return json({ why: "a write comes from this page only" }, 403);
  return null;
}
