import { ago, duration, schedule } from "./format";

export interface CrewRow {
  machine: string;
  position: string;
  tip: string;
  filledBy: string;
  now: string;
  card?: { repo: string; number: number };
  elapsed?: string;
}

const SLOT_NAMES: Record<string, string> = { "build-1": "builder 1", "build-2": "builder 2", review: "reviewer" };
const TIPS = {
  build: "Builds one card at a time, in the builder profile of that card's repo.",
  review: "Reviews one pull request at a time, in the reviewer profile of that card's repo.",
  foreman: "Picks the next card on every tick and starts a builder or reviewer in a free slot.",
  waiting: "Checks the cards that wait on James and moves the ones that do not belong in their waiting status.",
};
const WAITING_PROFILE = "waiting-crew";
const UNKNOWN_SLOTS = Object.keys(SLOT_NAMES).map((slot) => ({ slot, role: slot === "review" ? "review" : "build" }));

const cadence = (job: any) =>
  /^every 60m$/i.test(job.schedule_raw || "") ? "hourly" : schedule(job.schedule_raw || job.schedule);
const filled = (job: any) => `${job.agent ? "agent" : "script"}, ${cadence(job)}`;
const clock = (when: string) =>
  new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function slotNow(s: any, paused: boolean): Pick<CrewRow, "now" | "card" | "elapsed"> {
  if (paused) return { now: "paused" };
  if (s.state !== "held") return { now: "free" };
  if (!s.repo || s.card == null) return { now: "busy" };
  const elapsed = duration(s.seconds || 0);
  return { now: `${s.repo}#${s.card}, ${elapsed}`, card: { repo: s.repo, number: s.card }, elapsed };
}

function machineRows(m: any, nowMs: number): CrewRow[] {
  const down = Boolean(m.error);
  if (!m.crew && !down) return [];
  const jobs: any[] = m.jobs || [];
  const foreman = jobs.find((j) => j.name === "foreman" && j.profile === "default");
  const waiting = jobs.find((j) => j.profile === WAITING_PROFILE);
  const row = (
    position: string,
    tip: string,
    filledBy: string,
    state: Pick<CrewRow, "now" | "card" | "elapsed">,
  ): CrewRow => ({
    machine: m.name,
    position,
    tip,
    filledBy,
    ...(down ? { now: "unreachable" } : state),
  });
  const rows = (m.crew?.slots || UNKNOWN_SLOTS).map((s: any) =>
    row(
      SLOT_NAMES[s.slot] || s.slot,
      TIPS[s.role === "review" ? "review" : "build"],
      s.state === "held" && s.profile && !down ? `agent, ${s.profile}` : "agent",
      slotNow(s, Boolean(m.crew?.paused)),
    ),
  );
  if (foreman || (down && !m.crew))
    rows.push(
      row("foreman", TIPS.foreman, foreman ? filled(foreman) : "script", {
        now: foreman?.last_run_at ? `last tick ${ago(foreman.last_run_at, nowMs)}` : "no tick yet",
      }),
    );
  if (waiting)
    rows.push(
      row("waiting crew", TIPS.waiting, filled(waiting), {
        now: waiting.next_run_at ? `next run ${clock(waiting.next_run_at)}` : "no run planned",
      }),
    );
  return rows;
}

export const crewRows = (machines: any[], nowMs = Date.now()): CrewRow[] =>
  machines.flatMap((m) => machineRows(m, nowMs));
