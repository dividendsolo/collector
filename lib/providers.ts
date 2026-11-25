export interface ChainProfile {
  name?: string | null;
  provider?: string | null;
  fallbacks?: string[] | null;
}

export interface ChainMachine {
  name: string;
  profiles?: ChainProfile[] | null;
}

export interface Where {
  machine: string;
  name: string;
}

export interface RemovalPlan {
  profiles: number;
  machines: string[];
  providers: string[];
  named: number;
  blocked: Where[];
  empty: Where[];
}

export const providerSlug = (provider: string | null | undefined): string =>
  typeof provider === "string" && provider.startsWith("claude") ? "anthropic" : (provider ?? "");

export const FALLBACK_IS_MAIN = "A provider that is a profile's main provider cannot be removed from its fallbacks.";

const named = (where: Where[]): string => [...new Set(where.map((w) => w.name))].sort().join(", ");

export function removalPlan(machines: ChainMachine[], slug: string): RemovalPlan {
  const names = new Set<string>();
  const where = new Set<string>();
  const providers = new Set<string>();
  const blocked: Where[] = [];
  const empty: Where[] = [];
  let named = 0;
  for (const machine of machines || []) {
    for (const profile of machine.profiles || []) {
      const chain = profile.fallbacks || [];
      const main = providerSlug(profile.provider);
      const mine = chain.filter((f) => providerSlug(f) === slug);
      if (main !== slug && !mine.length) continue;
      const name = profile.name || "";
      names.add(name);
      where.add(machine.name);
      for (const f of mine) providers.add(f);
      named += mine.length;
      if (main === slug) blocked.push({ machine: machine.name, name });
      if (mine.length && mine.length === chain.length) empty.push({ machine: machine.name, name });
    }
  }
  providers.add(slug);
  return {
    profiles: names.size,
    machines: [...where],
    providers: [...providers],
    named,
    blocked,
    empty,
  };
}

export function removalRefusal(plan: RemovalPlan, name: string): string | null {
  const main = named(plan.blocked);
  if (main) return `${FALLBACK_IS_MAIN} It is the main provider of ${main}.`;
  if (!plan.named) return `No Hermes profile names ${name} in its fallbacks, so there is nothing to remove.`;
  return null;
}

export const removalQuestion = (plan: RemovalPlan, name: string): string =>
  `Remove ${name} from the fallbacks of ${plan.profiles} ${plan.profiles === 1 ? "agent" : "agents"} on ${plan.machines.join(" and ")}?`;

export const emptyNote = (plan: RemovalPlan): string => {
  const names = named(plan.empty);
  return names ? `Left with no fallback: ${names}.` : "";
};

export const addQuestion = (provider: string, model: string, machines: string[]): string =>
  `Append ${provider} / ${model} to the fallbacks of every Hermes profile on ${machines.join(" and ")}?`;
