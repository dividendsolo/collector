import { subscribe } from "@/lib/server/board";

export const dynamic = "force-dynamic";

/** Server-sent events: the board view on connect, then on every change the 10-second board read sees. */
export function GET(req: Request) {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (text: string) => {
        try {
          ctrl.enqueue(enc.encode(text));
        } catch {
          stop();
        }
      };
      const off = subscribe((v) => send(`event: board\ndata: ${JSON.stringify(v)}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 15_000);
      send("retry: 3000\n\n");
      stop = () => {
        off();
        clearInterval(ping);
        stop = () => {};
      };
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          ctrl.close();
        } catch {}
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
