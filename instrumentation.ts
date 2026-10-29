/**
 * At server start: record the build this process runs, then begin the board poll and warm every slow reader, so the
 * first page finds data waiting. The build is read here, once, before anything can move the folder under the server:
 * the Update click's swap (`scripts/apply-update.ts`) leaves the new build on disk while this process still serves
 * the old one, and `/api/version` must keep reporting what this process runs or an open page would reload onto a
 * build the server is not running yet.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { readSide, rememberServed } = await import("./lib/update");
  const build = readSide(process.cwd());
  rememberServed(build);
  // A stamped start line, and a SIGTERM that logs itself and ends the open event streams (card #41).
  const { watchLifecycle } = await import("./lib/server/lifecycle");
  watchLifecycle(build);
  const { warm } = await import("./lib/server/warm");
  warm();
}
