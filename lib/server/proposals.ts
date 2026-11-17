import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { newestFirst, PROPOSAL_STATUSES, type Proposal, pipelineValue } from "../proposals";
import { PROPOSALS_PATH } from "./paths";

const NO_MARKS = /[<>]/;
const NO_LINK = /https?:\/\/|www\./i;
const plain = (s: string) => !NO_MARKS.test(s) && !NO_LINK.test(s);

const realDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine(realDay, "a real day");

const label = (max: number) => z.string().trim().min(1).max(max).refine(plain, "no <, > or a link");

const fields = {
  client: label(100),
  title: label(100),
  amount: z.number().min(0).max(10_000_000),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "a 3-letter currency code"),
  status: z.enum(PROPOSAL_STATUSES),
  sent_at: day.nullable().default(null),
  decided_at: day.nullable().default(null),
  notes: z.string().trim().max(1000).refine(plain, "no <, > or a link").default(""),
};

const id = z.string().min(1).max(100);

export const addSchema = z.object(fields);
export const editSchema = z.object({ id, ...fields });
const record = z.object({ ...fields, id, created_at: z.number(), updated_at: z.number() });

export type ProposalFields = z.infer<typeof addSchema>;

export class ProposalsFileError extends Error {}

function load(): { list: Proposal[]; refused: number } {
  let text: string;
  try {
    text = fs.readFileSync(PROPOSALS_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { list: [], refused: 0 };
    throw new ProposalsFileError(`${PROPOSALS_PATH} could not be read (${(e as Error).message}); nothing was written`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProposalsFileError(
      `${PROPOSALS_PATH} does not parse as JSON (${(e as Error).message}); fix it by hand, nothing was written`,
    );
  }
  if (!Array.isArray(raw))
    throw new ProposalsFileError(`${PROPOSALS_PATH} is not a list; fix it by hand, nothing was written`);
  const list = raw.flatMap((row) => {
    const known = record.safeParse(row);
    return known.success ? [known.data] : [];
  });
  return { list: newestFirst(list), refused: raw.length - list.length };
}

export const listProposals = (): Proposal[] => load().list;

function current(): Proposal[] {
  const { list, refused } = load();
  if (refused) throw new ProposalsFileError(refusedWhy(refused));
  return list;
}

const refusedWhy = (n: number) =>
  `${PROPOSALS_PATH} holds ${n} row(s) this page does not accept; fix them by hand, nothing is written until then`;

function save(list: Proposal[]): Proposal[] {
  const next = newestFirst(list);
  fs.mkdirSync(path.dirname(PROPOSALS_PATH), { recursive: true });
  const tmp = `${PROPOSALS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, PROPOSALS_PATH);
  return next;
}

export function addProposal(input: ProposalFields): Proposal[] {
  const at = Date.now();
  const p: Proposal = {
    ...input,
    currency: input.currency.toUpperCase(),
    id: randomUUID(),
    created_at: at,
    updated_at: at,
  };
  return save([...current(), p]);
}

export function editProposal(id: string, input: ProposalFields): Proposal[] | null {
  const list = current();
  const at = list.findIndex((p) => p.id === id);
  if (at === -1) return null;
  const next = [...list];
  next[at] = { ...list[at], ...input, currency: input.currency.toUpperCase(), updated_at: Date.now() };
  return save(next);
}

export function deleteProposal(id: string): Proposal[] | null {
  const list = current();
  const next = list.filter((p) => p.id !== id);
  return next.length === list.length ? null : save(next);
}

export const proposalsView = (list = listProposals()) => ({ proposals: list, pipeline: pipelineValue(list) });

export function proposalsRead(): ReturnType<typeof proposalsView> & { why?: string } {
  try {
    const { list, refused } = load();
    return refused ? { ...proposalsView(list), why: refusedWhy(refused) } : proposalsView(list);
  } catch (e) {
    if (e instanceof ProposalsFileError) return { ...proposalsView([]), why: e.message };
    throw e;
  }
}
