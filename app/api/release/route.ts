import { poll } from "@/lib/server/board";
import { guard, refusePhone } from "@/lib/server/guard";
import { expandHome } from "@/lib/server/paths";
import { json } from "@/lib/server/respond";
import { runText } from "@/lib/server/run";
import { AGENT_STACK_STATUSES } from "@/lib/statuses";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refusal = guard(req) ?? refusePhone(req);
  if (refusal) return refusal;
  const body = await req.json().catch(() => ({}));
  const { repo, number, from } = body as { repo?: unknown; number?: unknown; from?: unknown };
  if (typeof repo !== "string" || !/^[\w.-]+$/.test(repo) || repo.includes(".."))
    return json({ ok: false, why: "bad repo" }, 400);
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1)
    return json({ ok: false, why: "bad number" }, 400);
  if (typeof from !== "string" || !AGENT_STACK_STATUSES.waiting.includes(from))
    return json({ ok: false, why: "not a waiting lane" }, 400);
  const r = await runText(
    [expandHome("~/.local/bin/status"), "set", `${repo}#${number}`, "ready-for-agent", "--expect", from],
    { timeout: 30 },
  );
  if (!r.ok) return json({ ok: false, why: (r.error || r.stdout || "status failed").trim().slice(0, 200) }, 409);
  await poll("release").catch(() => {});
  return json({ ok: true });
}
