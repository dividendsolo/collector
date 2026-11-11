import { describe, expect, it } from "vitest";
import { warnings } from "@/lib/server/warnings";

/**
 * James, 2026-11-11, on a Supabase incident row that read "25 s ago": "I'm hoping it's not time ago since it showed on
 * the board, that's useless". A row's age is when the thing itself happened: the vendor's own open time for an
 * incident, the failed run's time for a job. Collector's first sight of a row is only the fallback.
 */
const base = { github: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;
const at = (iso: string) => Date.parse(iso) / 1000;

describe("a row's age", () => {
  it("is when the vendor opened the incident, the oldest one when there are several", () => {
    const [row] = warnings({
      ...base,
      cfg: { vendors: [{ name: "Supabase", url: "u", attention: true }] },
      machines: [],
      vendors: [
        {
          name: "Supabase",
          url: "u",
          state: "minor",
          incidents: [
            { name: "A", impact: "minor", url: "u", opened: "2026-11-11T09:00:00Z" },
            { name: "B", impact: "minor", url: "u", opened: "2026-11-10T22:00:00Z" },
          ],
        },
      ],
    });
    expect(row.since).toBe(at("2026-11-10T22:00:00Z"));
  });

  it("is when the failed run ran", () => {
    const [row] = warnings({
      ...base,
      cfg: {},
      machines: [
        {
          name: "ezio",
          jobs: [
            {
              id: "b07ecfc6da04",
              name: "cve-watch",
              enabled: true,
              last_status: "error",
              last_run_at: "2026-11-11T13:16:03.189403+00:00",
            },
          ],
        },
      ],
    });
    expect(row.since).toBe(at("2026-11-11T13:16:03.189403+00:00"));
  });

  it("is left to first sight when the feed gives no time", () => {
    const [row] = warnings({
      ...base,
      cfg: { vendors: [{ name: "X", url: "u", attention: true }] },
      machines: [],
      vendors: [{ name: "X", url: "u", state: "minor", incidents: [{ name: "A", impact: "minor", url: "u" }] }],
    });
    expect(row.since).toBeUndefined();
  });
});
