export interface Brief {
  machine: string;
  file: string;
  brief: string | null;
  subject: string | null;
  sent_at: string | null;
  read: boolean;
  archived: boolean;
}

export const keyOf = (brief: Pick<Brief, "machine" | "file">) => `${brief.machine}/${brief.file}`;

export const isBriefFile = (file: unknown): file is string =>
  typeof file === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(file);

const byFile = (a: Brief, b: Brief) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

export const inbox = (briefs: Brief[]) => briefs.filter((b) => !b.archived).sort(byFile);

export const archived = (briefs: Brief[]) =>
  briefs
    .filter((b) => b.archived)
    .sort(byFile)
    .reverse();
