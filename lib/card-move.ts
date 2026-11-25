import { AGENT_STACK_ALL } from "./statuses";

export const MOVE_PRIORITIES = ["none", "P0", "P1", "P2"];

export interface CardMove {
  repo: string;
  number: number;
  status: string;
  priority: string;
}

export type MoveCheck = { ok: true; move: CardMove } | { ok: false; why: string };

const REPO = /^[\w.-]+$/;
const NO_CARD = "Name the card as owner/repo and its number.";

export function checkMove(input: unknown): MoveCheck {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const repo = typeof i.repo === "string" ? i.repo : "";
  const number = typeof i.number === "number" ? i.number : Number.NaN;
  const status = typeof i.status === "string" ? i.status : "";
  const priority = typeof i.priority === "string" ? i.priority : "";
  if (!REPO.test(repo) || repo.includes("..") || !Number.isInteger(number) || number < 1)
    return { ok: false, why: NO_CARD };
  if (!status && !priority) return { ok: false, why: "A move sets a status, a priority, or both." };
  if (status && !AGENT_STACK_ALL.includes(status)) return { ok: false, why: "Choose a status from the list." };
  if (priority && !MOVE_PRIORITIES.includes(priority))
    return { ok: false, why: `The priority is one of ${MOVE_PRIORITIES.join(", ")}.` };
  return { ok: true, move: { repo, number, status, priority } };
}

export const closesCard = (status: string, done: string[]) => done.includes(status);
