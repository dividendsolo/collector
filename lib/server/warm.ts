import { ai } from "./ai";
import { startBoard } from "./board";
import { datafast } from "./datafast";
import { domains } from "./domains";
import { snapshot } from "./machines";
import { projects } from "./projects";
import { checkServices } from "./services";
import { vendors } from "./vendors";
import { workStats } from "./workstats";

/** Start the board poll and fill each cache in the background. Nothing here blocks the server. */
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
}
