/**
 * The Briefs rules, shared by the page and the server (collector#64). A Brief is one report a cron job wrote for
 * James and emailed; every one Collector reads was kept as a file on the machine that sent it (agent-stack#286), so a
 * brief's identity is the machine it lives on and the file it is kept in. The terms are in GLOSSARY.md: the Inbox is
 * every brief that is not Archived, oldest first; a Read brief stays in the Inbox, dimmed, until it is Archived; and
 * only James archives one.
 */

export interface Brief {
  /** The machine the brief is kept on, by the name in `config.json`'s `machines`. */
  machine: string;
  /** The file it is kept in, the writer's own name: `<UTC stamp>-<brief slug>-<6 hex>.md`. */
  file: string;
  /** The brief's name, from the front matter (`Lead Watch`). */
  brief: string | null;
  /** The subject it was emailed under. */
  subject: string | null;
  /** When it went out, UTC, from the front matter. */
  sent_at: string | null;
  /** James has opened it. Kept on this machine (`lib/server/briefs.ts`), never on the machine that has the file. */
  read: boolean;
  /** James has finished with it: it has left the Inbox for the Archived section, and is never counted again. */
  archived: boolean;
}

/** One brief's identity: the machine it is on and its file name. The name carries the UTC stamp the brief was saved
 * at, so two briefs are never the same one. */
export const keyOf = (brief: Pick<Brief, "machine" | "file">) => `${brief.machine}/${brief.file}`;

/** A brief's file name as the writer makes it, and never a path: `collect.py` reads one file of its Briefs folder and
 * nothing else, so a name with a slash or a leading dot is refused here rather than over ssh. */
export const isBriefFile = (file: unknown): file is string =>
  typeof file === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(file);

/** The file name starts with the UTC stamp the brief was saved at, so sorting by the name is sorting by time, across
 * every machine. A name equal to another's is the same brief, and the order of two of those does not matter. */
const byFile = (a: Brief, b: Brief) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/** The Inbox: every brief that is not archived, oldest first — he works down it. The count on the sidebar's Briefs
 * link is this list's length. */
export const inbox = (briefs: Brief[]) => briefs.filter((b) => !b.archived).sort(byFile);

/** The Archived section: what he has finished, newest first, so the last one he filed is at the top. */
export const archived = (briefs: Brief[]) =>
  briefs
    .filter((b) => b.archived)
    .sort(byFile)
    .reverse();
