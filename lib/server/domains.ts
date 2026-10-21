import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { swr } from "./cache";
import { config } from "./config";
import { envStamp, secret } from "./env";
import { bearer, getJson, HttpError, why } from "./http";
import { ENV_PATH, HOME } from "./paths";
import { runText } from "./run";

export interface Domain {
  name: string;
  registered?: boolean;
  registrar?: string | null;
  expires?: string | null;
  since?: string | null;
  error?: string;
  ssl_expires?: string | null;
  days?: number | null;
  ssl_days?: number | null;
  auto_renew?: boolean | null;
  renew_source?: string | null;
}

/** Registrar and dates from an RDAP answer. Null when it has no expiry (whois decides). */
export function parseRdap(j: any): Partial<Domain> | null {
  const events: Record<string, string> = {};
  for (const e of j?.events || []) events[e.eventAction] = (e.eventDate || "").slice(0, 10);
  let registrar: string | null = null;
  for (const e of j?.entities || []) {
    if (!(e.roles || []).includes("registrar")) continue;
    const fn = ((e.vcardArray || [null, []])[1] || []).find((x: any[]) => x[0] === "fn");
    if (fn) {
      registrar = fn[3];
      break;
    }
  }
  registrar = registrar ? registrar.trim().replace(/\.+$/, "") : null;
  if (!events.expiration) return null;
  return { registered: true, registrar, expires: events.expiration, since: events.registration || null };
}

/** The fallback for registries without RDAP (.io): the whois text. */
export function parseWhois(text: string): Partial<Domain> {
  if (/^(no match|not found|domain not found|no data found)/im.test(text)) return { registered: false };
  const exp = text.match(
    /^\s*(?:registry expiry date|registrar registration expiration date|expir\w* date):\s*(\d{4}-\d{2}-\d{2})/im,
  );
  const reg = text.match(/^\s*registrar:\s*(.+)$/im);
  const since = text.match(/^\s*creation date:\s*(\d{4}-\d{2}-\d{2})/im);
  if (!exp) return reg ? { error: "whois shows no expiry date" } : { registered: false };
  return {
    registered: true,
    registrar: reg ? reg[1].trim().replace(/\.+$/, "") : null,
    expires: exp[1],
    since: since ? since[1] : null,
  };
}

async function rdap(name: string) {
  try {
    return parseRdap(await getJson(`https://rdap.org/domain/${name}`, { Accept: "application/rdap+json" }, 15));
  } catch {
    return null; // a 404 can mean "no RDAP for this TLD" (.io): whois decides
  }
}

async function whois(name: string) {
  const r = await runText(["whois", name], { timeout: 20 });
  if (!r.stdout && r.error) return { error: "no RDAP and no whois answer" };
  return parseWhois(r.stdout);
}

/** When the HTTPS certificate on the domain runs out (YYYY-MM-DD), or null. */
function certExpiry(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host: name, port: 443, servername: name, timeout: 8000 }, () => {
      const after = sock.getPeerCertificate()?.valid_to;
      sock.end();
      resolve(after ? new Date(after).toISOString().slice(0, 10) : null);
    });
    sock.on("error", () => resolve(null));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(null);
    });
  });
}

/** Whole days until a YYYY-MM-DD date (local midnight), counting today. */
export function daysLeft(day: string | null | undefined, now = Date.now()): number | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor((new Date(y, m - 1, d).getTime() - now) / 86_400_000) + 1;
}

const VERCEL_AUTH = path.join(HOME, "Library/Application Support/com.vercel.cli/auth.json");

/** {domain: auto-renew} for domains bought through Vercel. Key: VERCEL_TOKEN, else the Vercel CLI's own login. */
async function vercelRenew(): Promise<Record<string, boolean>> {
  let token = secret("VERCEL_TOKEN");
  if (!token) {
    try {
      token = JSON.parse(fs.readFileSync(VERCEL_AUTH, "utf8")).token;
    } catch {
      return {};
    }
  }
  if (!token) return {};
  const out: Record<string, boolean> = {};
  try {
    const teams = ((await getJson("https://api.vercel.com/v2/teams", bearer(token), 15)).teams || []).map(
      (t: any) => t.id,
    );
    for (const team of [null, ...teams]) {
      const url = `https://api.vercel.com/v5/domains?limit=100${team ? `&teamId=${team}` : ""}`;
      for (const d of (await getJson(url, bearer(token), 15)).domains || []) {
        if (d.boughtAt) out[d.name] = Boolean(d.renew);
      }
    }
  } catch {}
  return out;
}

/** {domain: auto-renew} from Cloudflare Registrar, with CLOUDFLARE_REGISTRAR_TOKEN. */
async function cloudflareRenew(): Promise<{ renew: Record<string, boolean>; error: string | null }> {
  const token = secret("CLOUDFLARE_REGISTRAR_TOKEN");
  if (!token) return { renew: {}, error: null };
  const renew: Record<string, boolean> = {};
  let error: string | null = null;
  try {
    const accounts = (await getJson("https://api.cloudflare.com/client/v4/accounts", bearer(token), 15)).result || [];
    if (!accounts.length)
      error = "The token cannot see your account: add Account Settings Read, and set Account Resources to your account";
    for (const acct of accounts) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${acct.id}/registrar/domains`;
      for (const d of (await getJson(url, bearer(token), 15)).result || []) {
        if ("auto_renew" in d) renew[d.name] = Boolean(d.auto_renew);
      }
    }
  } catch (e) {
    error =
      e instanceof HttpError
        ? `Cloudflare refused the token (HTTP ${e.code}): it needs Registrar read access`
        : `Cloudflare did not answer: ${why(e).slice(0, 120)}`;
  }
  return { renew, error };
}

async function checkDomain(name: string): Promise<Domain> {
  const row: Domain = { name, ...((await rdap(name)) || (await whois(name))) };
  if (row.registered) row.ssl_expires = await certExpiry(name);
  row.days = daysLeft(row.expires);
  row.ssl_days = daysLeft(row.ssl_expires);
  return row;
}

interface DomainState {
  at: number;
  list: Domain[];
  cf_error: string | null;
}

const DOMAIN_TTL = 12 * 3600_000; // registry dates change once a year; twice a day is plenty

const cache = swr<DomainState>(
  "domains",
  (v) => (v.cf_error ? 60_000 : DOMAIN_TTL), // a key fixed on Cloudflare's side shows within a minute
  async () => {
    const listed = config().domains || [];
    const [vercel, cf, rows] = await Promise.all([
      vercelRenew(),
      cloudflareRenew(),
      Promise.all(listed.map(checkDomain)),
    ]);
    const known = { ...cf.renew, ...vercel };
    for (const r of rows) {
      r.auto_renew = known[r.name] ?? null;
      r.renew_source = (r.registrar || "").startsWith("Cloudflare") ? "Cloudflare" : r.name in vercel ? "Vercel" : null;
    }
    return { at: Math.floor(Date.now() / 1000), list: rows, cf_error: cf.error };
  },
);

/** Every domain in config.json. Read every 12 hours, and at once when the list or .env changes. */
export async function domains() {
  const key = `${(config().domains || []).join(",")}|${envStamp()}`;
  const d = await cache.get({ key });
  return {
    at: d.at,
    domains: d.list,
    env_path: ENV_PATH,
    cloudflare: {
      key: "CLOUDFLARE_REGISTRAR_TOKEN",
      present: Boolean(secret("CLOUDFLARE_REGISTRAR_TOKEN")),
      error: d.cf_error,
    },
  };
}

export const lastDomains = () => cache.peek()?.list ?? [];
