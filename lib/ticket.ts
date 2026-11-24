import { AGENT_STACK_ALL, TRIAGE_FIRST } from "./statuses";

export const TICKET_TYPES = ["bug", "enhancement", "tech-debt", "security"];
export const TICKET_PRIORITIES = ["none", "P0", "P1", "P2"];
export const TITLE_MAX = 256;
export const BODY_MAX = 20_000;

export interface TicketDraft {
  repo: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  status: string;
}

export const newTicket = (repo = ""): TicketDraft => ({
  repo,
  title: "",
  body: "",
  type: "",
  priority: "none",
  status: TRIAGE_FIRST,
});

export const PRIORITY_GATE =
  "A card leaves needs-triage only with a priority: choose P0, P1 or P2, or keep needs-triage.";

const str = (v: unknown) => (typeof v === "string" ? v : "");

export type TicketCheck = { ok: true; ticket: TicketDraft } | { ok: false; why: string };

export function checkTicket(input: unknown, roster: string[]): TicketCheck {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const t: TicketDraft = {
    repo: str(i.repo),
    title: str(i.title).trim(),
    body: str(i.body).trim(),
    type: str(i.type),
    priority: str(i.priority) || "none",
    status: str(i.status) || TRIAGE_FIRST,
  };
  if (!roster.includes(t.repo)) return { ok: false, why: "Choose a repo from the roster." };
  if (!t.title) return { ok: false, why: "A card needs a title." };
  if (t.title.length > TITLE_MAX || /[\r\n]/.test(t.title))
    return { ok: false, why: `The title is one line of ${TITLE_MAX} characters at most.` };
  if (t.body.length > BODY_MAX) return { ok: false, why: `The body is ${BODY_MAX} characters at most.` };
  if (!TICKET_TYPES.includes(t.type)) return { ok: false, why: `The type is one of ${TICKET_TYPES.join(", ")}.` };
  if (!TICKET_PRIORITIES.includes(t.priority))
    return { ok: false, why: `The priority is one of ${TICKET_PRIORITIES.join(", ")}.` };
  if (!AGENT_STACK_ALL.includes(t.status)) return { ok: false, why: "Choose a status from the list." };
  if (t.status !== TRIAGE_FIRST && t.priority === "none") return { ok: false, why: PRIORITY_GATE };
  return { ok: true, ticket: t };
}

export const ticketRequest = (d: TicketDraft) =>
  JSON.stringify({
    repo: d.repo,
    title: d.title.trim(),
    body: d.body.trim(),
    type: d.type,
    priority: d.priority,
    status: d.status,
  });

export const issueNumber = (url: string) => {
  const m = url.match(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)$/);
  return m ? Number(m[1]) : null;
};
