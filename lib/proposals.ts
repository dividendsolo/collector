export const PROPOSAL_STATUSES = ["draft", "pending", "approved", "rejected", "signed"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const OPEN_STATUSES: readonly ProposalStatus[] = ["draft", "pending", "approved"];

export interface Proposal {
  id: string;
  client: string;
  title: string;
  amount: number;
  currency: string;
  status: ProposalStatus;
  sent_at: string | null;
  decided_at: string | null;
  notes: string;
  created_at: number;
  updated_at: number;
}

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

export function newestFirst(list: Proposal[]): Proposal[] {
  return [...list].sort(
    (a, b) =>
      Number(!a.sent_at) - Number(!b.sent_at) ||
      (b.sent_at || "").localeCompare(a.sent_at || "") ||
      b.created_at - a.created_at,
  );
}
