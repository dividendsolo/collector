import fs from "node:fs";
import path from "node:path";
import { archived, type Brief, inbox, keyOf } from "../briefs";
import { type Config, config } from "./config";
import { collect, snapshot } from "./machines";
import { BRIEFS_PATH } from "./paths";

interface State {
  read: string[];
  archived: string[];
}

export class BriefsFileError extends Error {}

const EMPTY: State = { read: [], archived: [] };

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k) => typeof k === "string") : []);

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

export function setBriefState(key: string, change: { read?: boolean; archived?: boolean }): State {
  const state = load();
  const put = (list: string[], on: boolean | undefined) =>
    on === undefined ? list : on ? [...list.filter((k) => k !== key), key] : list.filter((k) => k !== key);
  return save({ read: put(state.read, change.read), archived: put(state.archived, change.archived) });
}

function stateForPage(): { state: State; why?: string } {
  try {
    return { state: load() };
  } catch (e) {
    return { state: EMPTY, why: (e as Error).message };
  }
}

const targets = (cfg: Config) => (cfg.machines?.length ? cfg.machines : [{ name: "this machine" }]);

export interface BriefsView {
  at: number;
  inbox: Brief[];
  archived: Brief[];
  why?: string;
}

export async function briefsView(): Promise<BriefsView> {
  const snap = await snapshot.get();
  const { state, why } = stateForPage();
  const rows: Brief[] = [];
  const problems: string[] = why ? [why] : [];
  for (const machine of snap.machines || []) {
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
