import { config } from "@/lib/server/config";
import { guard } from "@/lib/server/guard";
import { snapshot } from "@/lib/server/machines";
import { loginCommand, startLogin } from "@/lib/server/model-login";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const body = await req.json().catch(() => ({}));
  const machine = (config().machines || []).find((m) => m.name === body.machine);
  if (!machine) return json({ ok: false, why: "no such machine" }, 400);
  const cmd = loginCommand(machine, String(body.provider ?? ""));
  if (!cmd) return json({ ok: false, why: "no sign-in for that provider" }, 400);
  const r = await startLogin(cmd);
  if (!r.ok) return json(r, 500);
  if (r.signedIn) await snapshot.get({ force: true, wait: true }).catch(() => {});
  else setTimeout(() => snapshot.get({ force: true }).catch(() => {}), 60_000);
  return json(r);
}
