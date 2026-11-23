export type BoardColor = "red" | "yellow" | "orange" | "green" | "blue" | "purple";

export const BOARD_COLOR: Record<string, BoardColor> = {
  "needs-manual-qa": "red",
  "needs-info": "yellow",
  "needs-triage": "yellow",
  "ready-for-human": "green",
  scheduled: "blue",
  "ready-for-agent": "green",
  "changes-requested": "orange",
  "agent-in-progress": "orange",
  "code-review": "blue",
  "ready-to-merge": "green",
  merging: "purple",
};

export const statusPill = (status: string | null | undefined): string => {
  const color = BOARD_COLOR[status || ""];
  return color ? `board-${color}` : "";
};
