import { describe, expect, it, vi } from "vitest";
import { closeStreams } from "@/lib/server/lifecycle";

/**
 * Card #122: the rebuild job restarts the server with no click, so no click can mark the restart on the page any
 * more. The server says it itself: its SIGTERM ends every open `/api/events` stream with a `restarting` event, and the
 * page reads the failed reads that follow as the restart, not as an outage (James, 2026-11-06).
 */
vi.mock("@/lib/server/board", () => ({ subscribe: () => () => {} }));

describe("a SIGTERM's end of an open event stream", () => {
  it("tells the page the server is restarting before the stream closes", async () => {
    const { GET } = await import("@/app/api/events/route");
    const r = await GET(new Request("http://127.0.0.1:4000/api/events", { headers: { host: "127.0.0.1:4000" } }));
    expect(r.status).toBe(200);
    expect(closeStreams()).toBe(1);
    const text = await new Response(r.body).text();
    expect(text).toContain("event: restarting\n");
  });
});
