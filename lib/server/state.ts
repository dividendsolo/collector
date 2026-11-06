import { lastAi } from "./ai";
import { boardError } from "./board";
import { config } from "./config";
import { lastDomains } from "./domains";
import { firstSeen } from "./first-seen";
import { snapshot } from "./machines";
import { lastServices } from "./services";
import { lastVendors } from "./vendors";
import { warnings } from "./warnings";
import { lastX, xUsage } from "./x";

/** The page's main read: machines, the GitHub limit, Jog's runner minutes, X usage, subscriptions, notes, and Needs
 * attention. The warnings are worked out on every ask from the newest result of each reader. */
export async function state() {
  const [snap] = await Promise.all([snapshot.get(), xUsage()]);
  const cfg = config();
  const machines = structuredClone(snap.machines);
  const x = lastX();
  const list = warnings({
    machines,
    github: snap.github,
    cfg,
    services: lastServices(),
    domains: lastDomains(),
    ticketsError: boardError(),
    vendors: lastVendors(),
    x,
    ai: lastAi(),
  });
  const seen = firstSeen(list.map((w) => w.text));
  return {
    at: snap.at,
    machines,
    github: snap.github,
    jog: snap.jog,
    x,
    subscriptions: cfg.subscriptions || [],
    agent_notes: cfg.agent_notes || {},
    // Each row carries when it first showed up, for the age at the row's right edge.
    warnings: list.map((w) => ({ ...w, since: seen[w.text] })),
  };
}
