import { p0Rows, triageRow } from "@/lib/priority";
import { ticketsView } from "@/lib/server/board";
import { config } from "@/lib/server/config";
import {
  closeFixPane,
  fixKey,
  LOOP_GONE,
  mainChecksPrompt,
  mainKey,
  openDebugSession,
  openFixes,
  openFixPane,
  TRIAGE_KEY,
  triagePrompt,
  unblockKey,
  unblockPrompt,
  WORK_LOOP,
  workLoopPrompt,
} from "@/lib/server/debug-fix";
import { guard } from "@/lib/server/guard";
import { snapshot } from "@/lib/server/machines";
import { json } from "@/lib/server/respond";
import { brokenStep, warnings } from "@/lib/server/warnings";

export const dynamic = "force-dynamic";

/** The Debug and fix button of a failed cron row or the work script's loop row (James, 2026-11-11): opens a new pi session in a new tmux pane on this
 * machine, its first message the job's failure and the TDD flow. The page names the job only by machine and id;
 * the job's details come from Collector's own read, so the page cannot hand the session anything else. Only a job
 * whose last run failed is accepted. */
export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const body = await req.json().catch(() => null);
  // The Triage button (James, 2026-11-11): only for the one card in needs-triage now, by Collector's own read.
  if (body?.triage) {
    const t = ticketsView();
    const row = triageRow(t.tickets.filter((x: any) => t.each.includes(x.lane)));
    const card = row?.triage;
    if (!card || card.repo !== body.triage.repo || card.number !== body.triage.number)
      return json({ ok: false, why: "that card is not the one card waiting for triage now" }, 409);
    const r = await openFixPane(TRIAGE_KEY, triagePrompt(card), `triage ${card.repo}#${card.number}`);
    return json(r, r.ok ? 200 : 500);
  }
  // The Unblock button (James, 2026-11-11): only for a P0 card waiting on James now, by Collector's own read.
  if (body?.unblock) {
    const t = ticketsView();
    const waiting = t.tickets.filter((x: any) => t.each.includes(x.lane));
    const row = p0Rows(waiting).find(
      (r) => r.unblock?.repo === body.unblock.repo && r.unblock?.number === body.unblock.number,
    );
    const card = row && waiting.find((x: any) => x.url === row.url);
    if (!row?.unblock || !card) return json({ ok: false, why: "that card is not a P0 waiting on you now" }, 409);
    const r = await openFixPane(
      unblockKey(row.unblock),
      unblockPrompt({ ...row.unblock, lane: card.lane }),
      `unblock ${row.unblock.repo}#${row.unblock.number}`,
    );
    return json(r, r.ok ? 200 : 500);
  }
  // A main that fails its checks on a machine (James, 2026-11-11): only while that machine's marker is up.
  if (body?.fixMain) {
    const snap = await snapshot.get();
    const m = snap.machines.find((x: any) => x.name === body.fixMain.machine);
    const b = (m?.host_broken || []).find((x: any) => x.repo === body.fixMain.repo);
    if (!m || !b) return json({ ok: false, why: "main passes there now: nothing to fix" }, 409);
    const ssh = (config().machines || []).find((x: any) => x.name === m.name)?.ssh ?? null;
    const prompt = mainChecksPrompt(
      { machine: m.name, ssh, local: Boolean(m.local) },
      { repo: b.repo, ...brokenStep(b.line), error: b.error },
    );
    const r = await openFixPane(mainKey({ machine: m.name, repo: b.repo }), prompt, `${b.repo} main · ${m.name}`);
    return json(r, r.ok ? 200 : 500);
  }
  const machine = typeof body?.machine === "string" ? body.machine : "";
  const id = typeof body?.id === "string" ? body.id : "";
  const snap = await snapshot.get();
  const m = snap.machines.find((x: any) => x.name === machine);
  const ssh0 = (config().machines || []).find((x: any) => x.name === machine)?.ssh ?? null;
  // The work script's loop: only while the loop row is up for that machine.
  if (m && id === WORK_LOOP) {
    const cfg = config();
    const row = warnings({
      machines: [m],
      github: {},
      cfg,
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    } as any).find((w) => w.debug?.id === WORK_LOOP);
    if (!row) return json({ ok: false, why: LOOP_GONE }, 409);
    const prompt = workLoopPrompt({ machine, ssh: ssh0, local: Boolean(m.local) }, cfg.work_script || {}, row.text);
    const r = await openFixPane(fixKey(machine, WORK_LOOP), prompt, `work loop · ${machine}`);
    return json(r, r.ok ? 200 : 500);
  }
  const j = (m?.jobs || []).find((x: any) => x.id === id);
  if (!m || !j) return json({ ok: false, why: `no job ${id} on ${machine}` }, 404);
  if (!j.last_status || j.last_status.startsWith("ok"))
    return json({ ok: false, why: `${j.name}'s last run did not fail` }, 409);
  const ssh = (config().machines || []).find((x: any) => x.name === machine)?.ssh ?? null;
  const r = await openDebugSession({ machine, ssh, local: Boolean(m.local) }, j);
  return json(r, r.ok ? 200 : 500);
}

/** The Debug and fix panes open now, by job (machine/id), each with the step its session wrote: the button shows it
 * (James, 2026-11-11). */
export async function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  return json({ fixes: await openFixes() });
}

/** The Close button of a session that finished or is stuck (James, 2026-11-12: "I need that row to be resolved"):
 * closes that fix pane, so the row's button comes back to Debug and fix. Only a pane Collector tagged with that key
 * is closed; the key is matched against the open fixes, never passed to tmux as a target. */
export async function DELETE(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) return json({ ok: false, why: "no session named" }, 400);
  const r = await closeFixPane(key);
  return r.ok ? json({ ok: true }) : json(r, 409);
}
