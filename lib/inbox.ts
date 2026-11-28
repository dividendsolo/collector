import { moveTime } from "./journey";

export interface InboxMessage {
  machine: string;
  id: string;
  source: string;
  text: string;
  href: string | null;
  at: number | null;
  handled: boolean;
}

export const keyOf = (m: Pick<InboxMessage, "machine" | "id">) => `${m.machine}/${m.id}`;

const CONTROL = /[\p{Cc}]/u;
const ID_MAX = 200;

export const isInboxId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length <= ID_MAX && !CONTROL.test(id);

export const unhandled = (rows: InboxMessage[]) => rows.filter((r) => !r.handled);

export const inboxRows = (rows: InboxMessage[]) =>
  [...rows].sort((a, b) => Number(a.handled) - Number(b.handled) || (b.at ?? 0) - (a.at ?? 0));

export const inboxTime = (at: number | null) => (at === null ? "—" : moveTime(new Date(at * 1000).toISOString()));
