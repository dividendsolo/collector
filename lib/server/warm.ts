import { ai } from "./ai";
import { startBoard } from "./board";
import { datafast } from "./datafast";
import { domains } from "./domains";
import { snapshot } from "./machines";
import { projects } from "./projects";
import { checkServices } from "./services";
import { learnTailnetName, TAILNET_NAME_MS } from "./tailscale";
import { vendors } from "./vendors";
import { workStats } from "./workstats";

export function warm() {
  startBoard();
  const quiet = (p: Promise<unknown>) => p.catch((e) => console.log(`[warm] ${String(e?.message || e)}`));
  quiet(snapshot.get().then(() => ai.get()));
  quiet(checkServices());
  quiet(domains());
  quiet(vendors());
  quiet(datafast.get());
  quiet(projects());
  quiet(workStats());
  quiet(learnTailnetName());
  setInterval(() => quiet(learnTailnetName()), TAILNET_NAME_MS).unref();
}
