import path from "node:path";
import { type ChainMachine, type RemovalPlan, removalPlan } from "../providers";
import { ai } from "./ai";
import { config, type Machine } from "./config";
import { pythonOver, snapshot } from "./machines";
import { FALLBACKS, HERMES_HOME } from "./paths";
import { run } from "./run";

export interface ProfileWrite {
  profile: string;
  file: string;
  backup: string;
  entries: number;
}

export interface ProfileSkip {
  profile: string;
  why: string;
}

export interface MachineWrite {
  machine: string;
  ok: boolean;
  why?: string;
  changed: ProfileWrite[];
  skipped: ProfileSkip[];
  errors: ProfileSkip[];
}

interface Answer {
  changed?: ProfileWrite[];
  skipped?: ProfileSkip[];
  errors?: ProfileSkip[];
  error?: string;
}

export interface ModelChoice {
  provider: string;
  label: string;
  models: string[];
}

export const fallbackTargets = (): Machine[] => {
  const cfg = config();
  return cfg.machines?.length ? cfg.machines : [{ name: "this machine" }];
};

export const fallbackMachines = () => fallbackTargets().map((m) => m.name);

export async function planFor(slug: string): Promise<RemovalPlan> {
  const snap = await snapshot.get();
  return removalPlan((snap.machines ?? []) as ChainMachine[], slug);
}

const refused = (machine: string, a: Answer | null, why: string): MachineWrite => ({
  machine,
  ok: false,
  why: a?.error || why,
  changed: [],
  skipped: [],
  errors: [],
});

async function write(args: string[]): Promise<MachineWrite[]> {
  return Promise.all(
    fallbackTargets().map(async (machine) => {
      const { cmd, input } = pythonOver(machine, FALLBACKS, args);
      const [answer, why] = await run<Answer>(cmd, { attempts: 1, timeout: 60, ...(input ? { input } : {}) });
      if (!answer || answer.error) return refused(machine.name, answer, why || "no answer");
      return {
        machine: machine.name,
        ok: true,
        changed: answer.changed ?? [],
        skipped: answer.skipped ?? [],
        errors: answer.errors ?? [],
      };
    }),
  );
}

export const removeFallbacks = (names: string[]) => write(["remove", ...names]);

export const addFallback = (provider: string, model: string) => write(["add", provider, model]);

export async function answerWritten(): Promise<void> {
  await snapshot.get({ force: true, wait: true }).catch(() => {});
  await ai.get({ force: true, wait: true }).catch(() => {});
}

const CATALOG_SCRIPT = `
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
os.chdir(sys.path[0])
from hermes_cli.models import _PROVIDER_LABELS, _PROVIDER_MODELS
out = []
for name, label in _PROVIDER_LABELS.items():
    models = list(_PROVIDER_MODELS.get(name) or [])
    if models:
        out.append({"provider": name, "label": label, "models": models})
print(json.dumps(out))
`;

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
let catalogAt = 0;
let catalog: ModelChoice[] = [];

export async function modelCatalog(): Promise<ModelChoice[]> {
  if (catalogAt && Date.now() - catalogAt < CATALOG_TTL_MS) return catalog;
  const py = path.join(HERMES_HOME, "hermes-agent", "venv", "bin", "python");
  const [list] = await run<ModelChoice[]>([py, "-c", CATALOG_SCRIPT], { timeout: 30 });
  if (Array.isArray(list) && list.length) {
    catalog = list.filter((p) => p && typeof p.provider === "string" && Array.isArray(p.models));
    catalogAt = Date.now();
  }
  return catalog;
}
