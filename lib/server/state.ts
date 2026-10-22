import { lastAi } from "./ai";
import { boardError, boardGap } from "./board";
import { config } from "./config";
import { lastDomains } from "./domains";
import { snapshot } from "./machines";
import { lastServices } from "./services";
import { warnings } from "./warnings";
import { lastX, xUsage } from "./x";

/** The page's main read: machines, the GitHub limit, X usage, subscriptions, notes, and Needs attention. The
 * warnings are worked out on every ask from the newest result of each reader. */
export async function state() {
  const [snap] = await Promise.all([snapshot.get(), xUsage()]);
  const cfg = config();
  const machines = structuredClone(snap.machines);
  const x = lastX();
  return {
    at: snap.at,
    machines,
    github: snap.github,
    x,
    subscriptions: cfg.subscriptions || [],
    agent_notes: cfg.agent_notes || {},
    warnings: warnings({
      machines,
      github: snap.github,
      cfg,
      services: lastServices(),
      domains: lastDomains(),
      ticketsError: boardError(),
      boardGap: boardGap(),
      x,
      ai: lastAi(),
    }),
  };
}
