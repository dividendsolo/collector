import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crewRows } from "@/lib/crew";

const NOW = Date.parse("2026-11-23T14:00:00-05:00");
const FOREMAN = {
  scheduler: "Hermes",
  name: "foreman",
  profile: "default",
  agent: false,
  schedule_raw: "* * * * *",
  last_run_at: "2026-11-23T13:59:20-05:00",
  next_run_at: "2026-11-23T14:01:00",
};
const WAITING = {
  scheduler: "Hermes (waiting-crew)",
  name: "waiting-crew",
  profile: "waiting-crew",
  agent: true,
  schedule: "every 60m",
  schedule_raw: "every 60m",
  last_run_at: "2026-11-23T10:22:00",
  next_run_at: "2026-11-23T14:54:00",
};
const free = (slot: string, role: string) => ({ slot, role, state: "free" });
const ALTAIR = {
  name: "altair",
  jobs: [FOREMAN, WAITING],
  crew: {
    paused: false,
    slots: [
      {
        slot: "build-1",
        role: "build",
        state: "held",
        repo: "situation",
        card: 920,
        profile: "situation-builder",
        seconds: 2040,
      },
      free("build-2", "build"),
      {
        slot: "review",
        role: "review",
        state: "held",
        repo: "collector",
        card: 55,
        profile: "collector-reviewer",
        seconds: 360,
      },
    ],
  },
};
const EZIO = {
  name: "ezio",
  jobs: [{ ...FOREMAN, last_run_at: "2026-11-23T13:59:40-05:00" }],
  crew: { paused: false, slots: [free("build-1", "build"), free("build-2", "build"), free("review", "review")] },
};
const view = (rows: ReturnType<typeof crewRows>) => rows.map((r) => [r.machine, r.position, r.filledBy, r.now]);

describe("the Crew panel's rows (collector#231)", () => {
  it("lists each machine's positions, what fills them and what each does now", () => {
    const rows = crewRows([ALTAIR, EZIO], NOW);
    expect(view(rows)).toEqual([
      ["altair", "builder 1", "agent, situation-builder", "situation#920, 34 min"],
      ["altair", "builder 2", "agent", "free"],
      ["altair", "reviewer", "agent, collector-reviewer", "collector#55, 6 min"],
      ["altair", "foreman", "script, every minute", "last tick 40 s ago, next 14:01"],
      ["altair", "waiting crew", "agent, hourly", "last run 10:22, next 14:54"],
      ["ezio", "builder 1", "agent", "free"],
      ["ezio", "builder 2", "agent", "free"],
      ["ezio", "reviewer", "agent", "free"],
      ["ezio", "foreman", "script, every minute", "last tick 20 s ago, next 14:01"],
    ]);
    expect(rows[0].card).toEqual({ repo: "situation", number: 920 });
    expect(rows[1].card).toBeUndefined();
  });

  it("gives every position a one-sentence job description for its hover", () => {
    for (const r of crewRows([ALTAIR], NOW)) expect(r.tip).toMatch(/^[A-Z][^.]+\.$/);
  });

  it("reads unreachable on every row of a machine that does not answer, never free", () => {
    for (const m of [
      { ...EZIO, error: "ssh: connect timed out", stale: true },
      { name: "ezio", error: "no route" },
    ]) {
      const rows = crewRows([m], NOW);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) expect(r.now).toBe("unreachable");
      expect(rows[0].card).toBeUndefined();
    }
  });

  it("reads paused on the builder and reviewer rows of a paused machine", () => {
    const rows = crewRows([{ ...ALTAIR, crew: { ...ALTAIR.crew, paused: true } }], NOW);
    expect(rows.slice(0, 3).map((r) => r.now)).toEqual(["paused", "paused", "paused"]);
    expect(rows[3].now).toBe("last tick 40 s ago, next 14:01");
  });

  it("gives a machine with no waiting-crew profile no waiting-crew row", () => {
    expect(crewRows([EZIO], NOW).map((r) => r.position)).not.toContain("waiting crew");
  });

  it("gives a machine with no foreman no rows", () => {
    expect(crewRows([{ name: "laptop", jobs: [], crew: null }], NOW)).toEqual([]);
  });

  it("says busy for a held slot whose card is not known", () => {
    const m = { ...EZIO, crew: { paused: false, slots: [{ slot: "build-1", role: "build", state: "held" }] } };
    expect(crewRows([m], NOW)[0].now).toBe("busy");
  });
});

describe("the foreman and waiting crew rows say the last run and the next (collector#266)", () => {
  const timed = (jobs: object[]) =>
    crewRows([{ name: "altair", jobs, crew: { paused: false, slots: [] } }], NOW).map((r) => r.now);

  it("shows both for a job that has run and has a next run", () => {
    expect(timed([FOREMAN, WAITING])).toEqual(["last tick 40 s ago, next 14:01", "last run 10:22, next 14:54"]);
  });

  it("shows the last part alone for a job with no next run", () => {
    expect(
      timed([
        { ...FOREMAN, next_run_at: null },
        { ...WAITING, next_run_at: null },
      ]),
    ).toEqual(["last tick 40 s ago", "last run 10:22"]);
  });

  it("shows the next run beside the job's own words when it has never run", () => {
    expect(
      timed([
        { ...FOREMAN, last_run_at: null },
        { ...WAITING, last_run_at: null },
      ]),
    ).toEqual(["no tick yet, next 14:01", "no run yet, next 14:54"]);
  });

  it("shows the job's own words alone when it has neither", () => {
    expect(
      timed([
        { ...FOREMAN, last_run_at: null, next_run_at: null },
        { ...WAITING, last_run_at: null, next_run_at: null },
      ]),
    ).toEqual(["no tick yet", "no run yet"]);
  });
});

describe("the Dashboard's top row (collector#231)", () => {
  const source = readFileSync(path.join(__dirname, "..", "components", "dashboard.tsx"), "utf8");
  const dashboard = source.slice(source.indexOf("export function Dashboard()"));
  it("holds Priority tasks and Crew side by side in a pair", () => {
    expect(dashboard).toMatch(/<div className="pair">\s*<PriorityTasks \/>\s*<CrewPanel \/>\s*<\/div>/);
  });
});
