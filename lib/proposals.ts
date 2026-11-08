/**
 * A client proposal, and what the open ones are worth (collector#77). The page, the route and the file `proposals.json`
 * all read these rules, and Mission Control is where they come from: its `lib/types.ts` (`ProposalStatus`, `Proposal`)
 * and `lib/repo/proposals.ts` (`pipelineValue`), the working version of this page before it was retired.
 */

export const PROPOSAL_STATUSES = ["draft", "pending", "approved", "rejected", "signed"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** The statuses still out with a client: exactly what the open pipeline counts. */
export const OPEN_STATUSES: readonly ProposalStatus[] = ["draft", "pending", "approved"];

export interface Proposal {
  id: string;
  client: string;
  title: string;
  amount: number;
  /** A three-letter code, upper case (`USD`). */
  currency: string;
  status: ProposalStatus;
  /** The day it went out and the day the client answered, `YYYY-MM-DD`: null until each happens. */
  sent_at: string | null;
  decided_at: string | null;
  notes: string;
  created_at: number;
  updated_at: number;
}

/**
 * The open pipeline: draft, pending and approved added up per currency. A rejected or signed proposal is work already
 * lost or won, so it is not in the number — the point of the figure is what is still out with clients.
 */
export function pipelineValue(list: Proposal[]): { currency: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const p of list) {
    if (!OPEN_STATUSES.includes(p.status)) continue;
    totals.set(p.currency, (totals.get(p.currency) || 0) + p.amount);
  }
  return [...totals]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The order the table reads in: the newest that went out first, the ones that have not gone out yet after them, and
 * the newest written first within each (the order Mission Control's own query used). */
export function newestFirst(list: Proposal[]): Proposal[] {
  return [...list].sort(
    (a, b) =>
      Number(!a.sent_at) - Number(!b.sent_at) ||
      (b.sent_at || "").localeCompare(a.sent_at || "") ||
      b.created_at - a.created_at,
  );
}
