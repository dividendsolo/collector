export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { readSide, rememberServed } = await import("./lib/update");
  const build = readSide(process.cwd());
  rememberServed(build);
  const { watchLifecycle } = await import("./lib/server/lifecycle");
  watchLifecycle(build);
  const { warm } = await import("./lib/server/warm");
  warm();
}
