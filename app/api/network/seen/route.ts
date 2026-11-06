import { json } from "@/lib/server/respond";
import { clearMark } from "@/lib/server/seen";

export const dynamic = "force-dynamic";

/** The one write the Network check adds (collector#66): Seen drops one mark from a machine's seen-list, so it leaves
 * Needs attention and does not come back — the fact behind it stays in the list, which is what keeps it from being
 * reported again.
 *
 * The click carries the mark's own id, so it lives in the query (`?machine=ezio&id=process%3Acurl`), which is what
 * a Needs attention row can post with no body; a JSON body with `machine` and `id` is answered the same way, for a
 * shell or an agent.
 *
 * A post with no body needs no preflight, so any web page could send one to this machine: one from another site is
 * refused, or a page could clear a mark and hide a new process or a large upload. The browser names where a request
 * comes from (`Sec-Fetch-Site`, and `Origin` on older ones); a shell or an agent sends neither and is answered. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (fromAnotherSite(req, url)) return json({ why: "a Seen click comes from this page only" }, 403);
  let machine = url.searchParams.get("machine");
  let id = url.searchParams.get("id");
  if ((!machine || !id) && req.headers.get("content-type") === "application/json") {
    const body = await req.json().catch(() => ({}) as any);
    machine = machine || (typeof body?.machine === "string" ? body.machine : null);
    id = id || (typeof body?.id === "string" ? body.id : null);
  }
  if (!machine || !id) return json({ why: "machine and id are required" }, 400);
  const { cleared, marks } = await clearMark(machine, id);
  return json({ machine, id, cleared, marks });
}

/** True when a browser says the request comes from a page of another site: `Sec-Fetch-Site` other than same-origin
 * or none (typed in the address bar), or, where the browser sends no such header, an `Origin` whose host is not this
 * one. */
function fromAnotherSite(req: Request, url: URL): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== (req.headers.get("host") || url.host);
  } catch {
    return true;
  }
}
