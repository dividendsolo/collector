/** At server start: begin the board poll and warm every slow reader, so the first page finds data waiting. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warm } = await import("./lib/server/warm");
  warm();
}
