import { bytes } from "./format";
import type { NetworkMark } from "./server/network";

/** One mark of each kind in two or three words, for the pill it wears (collector#66). */
export const MARK_LABELS: Record<NetworkMark["kind"], string> = {
  process: "New process",
  destination: "New destination",
  upload: "Large upload",
  inbound: "Local knock",
};

/** Where the connection behind a mark went: the host name where reverse DNS gave one, with the address and port
 * after it — "downloads.example.com:443", "198.51.100.1:443", or just the name when the tool counted no port. */
export function markWhere(m: NetworkMark): string {
  const name = m.host || m.address || "";
  const address = m.host && m.address ? ` (${m.address})` : "";
  const port = m.port == null ? "" : `:${m.port}`;
  return `${name || "somewhere"}${address}${port}`;
}

/** What one mark says in words. The machine is named on the Dashboard's Needs attention row and left out on the
 * Network page, which already draws it inside that machine's panel. */
export function markText(m: NetworkMark, machine?: string): string {
  const who = m.process || "A process with no name";
  const on = machine ? ` on ${machine}` : "";
  if (m.kind === "process") return `${who}${on}: a process not seen here before, connected to ${markWhere(m)}`;
  if (m.kind === "destination") return `${who}${on}: connected somewhere new, ${markWhere(m)}`;
  if (m.kind === "upload") return `${who}${on}: sent ${bytes(m.bytes)} since the last read`;
  const from = m.address ? ` from ${m.address}` : "";
  const ran = m.process ? ` (${m.process})` : "";
  return `Something on the local network reached${on ? ` ${machine}` : " this machine"} on port ${m.port ?? "?"}${from}${ran}`;
}
