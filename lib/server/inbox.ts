import fs from "node:fs";
import path from "node:path";
import { type InboxMessage, inboxRows, keyOf, unhandled } from "../inbox";
import { snapshot } from "./machines";
import { INBOX_PATH } from "./paths";

interface State {
  handled: string[];
}

export class InboxFileError extends Error {}

const EMPTY: State = { handled: [] };

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);

const clean = (v: unknown): State => ({
  handled: [...new Set(strings((v as Partial<State> | null)?.handled))],
});

function load(): State {
  let text: string;
  try {
    text = fs.readFileSync(INBOX_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw new InboxFileError(`${INBOX_PATH} could not be read (${(e as Error).message}); nothing was written`);
  }
  try {
    return clean(JSON.parse(text));
  } catch (e) {
    throw new InboxFileError(
      `${INBOX_PATH} is not JSON (${(e as Error).message}); fix it by hand, nothing was written`,
    );
  }
}

function save(state: State): State {
  fs.mkdirSync(path.dirname(INBOX_PATH), { recursive: true });
  const tmp = `${INBOX_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, INBOX_PATH);
  return state;
}

export function setInboxHandled(key: string, handled: boolean): State {
  const state = load();
  const list = handled ? [...state.handled.filter((k) => k !== key), key] : state.handled.filter((k) => k !== key);
  return save({ handled: list });
}

function stateForPage(): { state: State; why?: string } {
  try {
    return { state: load() };
  } catch (e) {
    return { state: EMPTY, why: (e as Error).message };
  }
}

export interface InboxView {
  at: number;
  rows: InboxMessage[];
  unhandled: number;
  why?: string;
}

export async function inboxView(): Promise<InboxView> {
  const snap = await snapshot.get();
  const { state, why } = stateForPage();
  const rows: InboxMessage[] = [];
  const problems: string[] = why ? [why] : [];
  for (const machine of snap.machines || []) {
    if (machine.error) problems.push(`${machine.name} could not be read: ${machine.error}`);
    for (const line of machine.inbox || []) {
      const id = String(line.id ?? "");
      if (!id) continue;
      rows.push({
        machine: machine.name,
        id,
        source: String(line.source ?? ""),
        text: String(line.text ?? ""),
        href: line.href ?? null,
        at: line.at ?? null,
        handled: state.handled.includes(keyOf({ machine: machine.name, id })),
      });
    }
  }
  return {
    at: snap.at,
    rows: inboxRows(rows),
    unhandled: unhandled(rows).length,
    ...(problems.length ? { why: problems.join("; ") } : {}),
  };
}
