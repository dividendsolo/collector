import { checkMove, closesCard } from "@/lib/card-move";
import { poll } from "@/lib/server/board";
import { config } from "@/lib/server/config";
import { caller, guard } from "@/lib/server/guard";
import { expandHome } from "@/lib/server/paths";
import { json } from "@/lib/server/respond";
import { runText } from "@/lib/server/run";
import { statusSets } from "@/lib/statuses";

export const dynamic = "force-dynamic";

const STATUS = () => expandHome("~/.local/bin/status");
const said = (r: { error: string | null; stdout: string }, fallback: string) =>
  (r.error || r.stdout || fallback).trim().slice(0, 300);

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const check = checkMove(await req.json().catch(() => ({})));
  if (!check.ok) return json({ ok: false, why: check.why }, 400);
  const { repo, number, status, priority } = check.move;
  const card = `${repo}#${number}`;
  if (caller(req) === "phone" && closesCard(status, statusSets(config()).done))
    return json({ ok: false, why: "closing a card stays on the Mac" }, 403);

  if (status) {
    const moved = await runText([STATUS(), "set", card, status], { timeout: 30 });
    if (!moved.ok) return json({ ok: false, step: "status set", why: said(moved, "status set failed") }, 409);
  }
  if (priority && priority !== "none") {
    const ranked = await runText([STATUS(), "priority", card, priority], { timeout: 30 });
    if (!ranked.ok)
      return json({ ok: false, step: "status priority", why: said(ranked, "status priority failed") }, 409);
  }
  await poll("card-move").catch(() => {});
  return json({ ok: true, card, status, priority });
}
