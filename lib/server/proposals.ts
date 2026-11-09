import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { newestFirst, PROPOSAL_STATUSES, type Proposal, pipelineValue } from "../proposals";
import { PROPOSALS_PATH } from "./paths";

/**
 * The proposals, in one JSON file beside `config.json` (collector#77): the pattern Collector's other local state uses
 * (`network-seen.json`, `.first-seen.json`), and it keeps real client names out of a public repo.
 *
 * Every field is parsed here, on the server, before anything is stored — the input audit of 2026-11 (mission-control#1)
 * is the rule set: a client or a title is 1..100 characters and a note is up to 1000, none of them carrying `<`, `>` or
 * a link; an amount is a number from 0 to 10,000,000; a currency is a three-letter code; a status is one of the five;
 * and a date is a real day, so `2026-02-31` is refused. The page renders every one of them as text.
 *
 * The file is hand-editable, so the same schema reads it back: a row it does not know is left out of the page rather than
 * shown or crashed on, and kept in the file (see ProposalsFileError). Nothing is cached: the file is small.
 */

/** Neither markup nor a link: the two things a value from the page must never carry. */
const NO_MARKS = /[<>]/;
const NO_LINK = /https?:\/\/|www\./i;
const plain = (s: string) => !NO_MARKS.test(s) && !NO_LINK.test(s);

/** A day that exists: `2026-02-31` reads back as March, so it is not one. */
const realDay = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine(realDay, "a real day");

/** A client or a title: trimmed, 1..max characters, no markup and no link. */
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

/** What the page sends to add one, and to edit one. */
export const addSchema = z.object(fields);
export const editSchema = z.object({ id, ...fields });
/** A whole row as the file holds it: the fields above, plus what the route sets itself. */
const record = z.object({ ...fields, id, created_at: z.number(), updated_at: z.number() });

export type ProposalFields = z.infer<typeof addSchema>;

/**
 * The file is the only copy, so a write never starts from a guess: a file that does not parse, or holds a row the schema
 * refuses, stops every write with this error (named after the file) and stays exactly as it is until it is fixed by hand.
 */
export class ProposalsFileError extends Error {}

/** The file as it stands: its good rows, and how many it holds that the schema refuses. No file yet is no rows. */
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

/** Every proposal, newest first: a row the schema refuses is left out of the page, but kept in the file. */
export const listProposals = (): Proposal[] => load().list;

/** The list a write starts from: every row in the file, or a ProposalsFileError rather than a list missing some. */
function current(): Proposal[] {
  const { list, refused } = load();
  if (refused) throw new ProposalsFileError(refusedWhy(refused));
  return list;
}

const refusedWhy = (n: number) =>
  `${PROPOSALS_PATH} holds ${n} row(s) this page does not accept; fix them by hand, nothing is written until then`;

/** Write the list, newest first, and hand it back: the file holds exactly what the route answers. Through a temp file
 * and a rename, so a write cut short leaves the old file whole, never half of the new one. */
function save(list: Proposal[]): Proposal[] {
  const next = newestFirst(list);
  fs.mkdirSync(path.dirname(PROPOSALS_PATH), { recursive: true });
  const tmp = `${PROPOSALS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, PROPOSALS_PATH);
  return next;
}

/** One more proposal, with the id and the two times the route owns. */
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

/** Change one, keeping its id and the day it was written; null when no proposal carries that id. */
export function editProposal(id: string, input: ProposalFields): Proposal[] | null {
  const list = current();
  const at = list.findIndex((p) => p.id === id);
  if (at === -1) return null;
  const next = [...list];
  next[at] = { ...list[at], ...input, currency: input.currency.toUpperCase(), updated_at: Date.now() };
  return save(next);
}

/** Drop one; null when no proposal carries that id. */
export function deleteProposal(id: string): Proposal[] | null {
  const list = current();
  const next = list.filter((p) => p.id !== id);
  return next.length === list.length ? null : save(next);
}

/** What every handler answers: the list, and the open pipeline worked out from that same list. */
export const proposalsView = (list = listProposals()) => ({ proposals: list, pipeline: pipelineValue(list) });

/** The page's read: the rows it can show, plus why the file will not take a write, when it will not. */
export function proposalsRead(): ReturnType<typeof proposalsView> & { why?: string } {
  try {
    const { list, refused } = load();
    return refused ? { ...proposalsView(list), why: refusedWhy(refused) } : proposalsView(list);
  } catch (e) {
    if (e instanceof ProposalsFileError) return { ...proposalsView([]), why: e.message };
    throw e;
  }
}
