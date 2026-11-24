import { poll, readStatusRepos } from "@/lib/server/board";
import { guard } from "@/lib/server/guard";
import { expandHome } from "@/lib/server/paths";
import { json } from "@/lib/server/respond";
import { runText } from "@/lib/server/run";
import { checkTicket, issueNumber } from "@/lib/ticket";

export const dynamic = "force-dynamic";

const STATUS = () => expandHome("~/.local/bin/status");
const said = (r: { error: string | null; stdout: string }, fallback: string) =>
  (r.error || r.stdout || fallback).trim().slice(0, 300);

export async function GET(req: Request) {
  return guard(req) ?? json({ repos: (await readStatusRepos()) || [] });
}

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const input = await req.json().catch(() => ({}));
  const check = checkTicket(input, (await readStatusRepos()) || []);
  if (!check.ok) return json({ ok: false, why: check.why }, 400);
  const t = check.ticket;

  const made = await runText(
    ["gh", "issue", "create", "-R", t.repo, "--title", t.title, "--label", t.type, "--body-file", "-"],
    { timeout: 30, input: t.body },
  );
  const url = made.stdout.trim().split("\n").pop() || "";
  const number = issueNumber(url);
  if (!made.ok || !number)
    return json({ ok: false, step: "gh issue create", why: said(made, "gh gave no issue URL") }, 502);

  const card = `${t.repo}#${number}`;
  const answer = await moveCard(card, t.status, t.priority);
  await poll("new-ticket").catch(() => {});
  if (!answer) return json({ ok: true, url, number });
  return json({ ok: false, step: answer.step, url, number, why: `${card} was created but ${answer.why}` }, 502);
}

async function moveCard(card: string, status: string, priority: string) {
  const moved = await runText([STATUS(), "set", card, status], { timeout: 30 });
  if (!moved.ok) return { step: "status set", why: `not moved: ${said(moved, "status set failed")}` };
  if (priority === "none") return null;
  const ranked = await runText([STATUS(), "priority", card, priority], { timeout: 30 });
  if (!ranked.ok)
    return {
      step: "status priority",
      why: `got no priority (it is in ${status}): ${said(ranked, "status priority failed")}`,
    };
  return null;
}
