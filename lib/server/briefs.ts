import fs from "node:fs";
import path from "node:path";
import { archived, type Brief, inbox, keyOf } from "../briefs";
import { type Config, config } from "./config";
import { collect, snapshot } from "./machines";
import { BRIEFS_PATH } from "./paths";

/**
 * The Briefs page's server (collector#64): the files on the machines, and which of them James has read and archived.
 *
 * The files are read by `collect.py` on each machine and ride the snapshot every page already reads every 10 seconds,
 * so the list costs no extra ssh. One brief's Markdown does: opening one reads that file over the same ssh, since the
 * folder only ever grows.
 *
 * Read and Archived are this machine's own state, in one JSON file beside `config.json` (the proposals file's
 * pattern, temp file then rename): a browser reset and a Collector restart both leave it in place. The state is a key
 * per brief — the machine and the file name — and nothing prunes it: the file it names stays in the machine's folder,
 * so there is nothing to forget as the acks list does after 50.
 */

/** The one state file's two lists. */
interface State {
  read: string[];
  archived: string[];
}

/** A file a write must not start from a guess: it does not parse, so nothing is written over it until it is fixed by
 * hand, and the page says why instead of quietly starting again from an empty list. */
export class BriefsFileError extends Error {}

const EMPTY: State = { read: [], archived: [] };

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);

/** A hand-edited file is read for what it is: only the string keys, each one once. */
const clean = (v: unknown): State => {
  const raw = (v ?? {}) as Partial<State>;
  return { read: [...new Set(strings(raw.read))], archived: [...new Set(strings(raw.archived))] };
};

function load(): State {
  let text: string;
  try {
    text = fs.readFileSync(BRIEFS_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw new BriefsFileError(`${BRIEFS_PATH} could not be read (${(e as Error).message}); nothing was written`);
  }
  try {
    return clean(JSON.parse(text));
  } catch (e) {
    throw new BriefsFileError(
      `${BRIEFS_PATH} is not JSON (${(e as Error).message}); fix it by hand, nothing was written`,
    );
  }
}

function save(state: State): State {
  fs.mkdirSync(path.dirname(BRIEFS_PATH), { recursive: true });
  const tmp = `${BRIEFS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, BRIEFS_PATH);
  return state;
}

/** Read one brief, or archive one: what the page's two clicks ask for. A key on both lists is archived — it left the
 * Inbox when he filed it, whether or not he had opened it first. */
export function setBriefState(key: string, change: { read?: boolean; archived?: boolean }): State {
  const state = load();
  const put = (list: string[], on: boolean | undefined) =>
    on === undefined ? list : on ? [...list.filter((k) => k !== key), key] : list.filter((k) => k !== key);
  return save({ read: put(state.read, change.read), archived: put(state.archived, change.archived) });
}

/** The state as the page reads it: a file that does not parse reads as nothing read and nothing archived, with the
 * reason, rather than taking the whole page down. */
function stateForPage(): { state: State; why?: string } {
  try {
    return { state: load() };
  } catch (e) {
    return { state: EMPTY, why: (e as Error).message };
  }
}

/** The machines this Collector reads, as the snapshot reads them: the configured ones, else this one. */
const targets = (cfg: Config) => (cfg.machines?.length ? cfg.machines : [{ name: "this machine" }]);

export interface BriefsView {
  /** When the machines were read: the snapshot's own time. */
  at: number;
  /** The Inbox: every brief that is not archived, oldest first. */
  inbox: Brief[];
  /** What he has finished, newest first. */
  archived: Brief[];
  /** One plain line when a brief could not be read, or the state file could not: the page shows it above the list
   * rather than an empty page that would be a lie. */
  why?: string;
}

/** The page's read: every brief on every machine, in the Inbox or archived. */
export async function briefsView(): Promise<BriefsView> {
  const snap = await snapshot.get();
  const { state, why } = stateForPage();
  const rows: Brief[] = [];
  const problems: string[] = why ? [why] : [];
  for (const machine of snap.machines || []) {
    // A machine that could not be read says so: its Inbox would read empty, and empty would be a lie.
    if (machine.error) problems.push(`${machine.name} could not be read: ${machine.error}`);
    for (const file of machine.briefs || []) {
      const key = keyOf({ machine: machine.name, file: file.file });
      rows.push({
        machine: machine.name,
        file: file.file,
        brief: file.brief ?? null,
        subject: file.subject ?? null,
        sent_at: file.sent_at ?? null,
        read: state.read.includes(key),
        archived: state.archived.includes(key),
      });
    }
  }
  return {
    at: snap.at,
    inbox: inbox(rows),
    archived: archived(rows),
    ...(problems.length ? { why: problems.join("; ") } : {}),
  };
}

/** One brief read whole, over ssh: its front matter, its Markdown, and its own state. Either the brief, or the one
 * line that says why there is none — a machine `config.json` does not name, one that cannot be reached, or a file
 * that is no longer in the folder. */
export async function briefBody(
  machineName: string,
  file: string,
): Promise<{ brief?: Record<string, any>; why?: string }> {
  const cfg = config();
  const machine = targets(cfg).find((t) => t.name === machineName);
  if (!machine) return { why: `config.json has no machine named ${machineName}` };
  const [row, error] = await collect(machine, cfg, file);
  if (error) return { why: `${machineName} could not be read: ${error}` };
  if (!row) return { why: `${machineName} has no brief ${file}` };
  const { state } = stateForPage();
  const key = keyOf({ machine: machineName, file });
  return {
    brief: { ...row, machine: machineName, read: state.read.includes(key), archived: state.archived.includes(key) },
  };
}
