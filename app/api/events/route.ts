import { subscribe } from "@/lib/server/board";
import { guard } from "@/lib/server/guard";
import { openStream } from "@/lib/server/lifecycle";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
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
      const end = () => {
        stop();
        try {
          ctrl.close();
        } catch {}
      };
      const unlist = openStream(() => {
        send("event: restarting\ndata: {}\n\n");
        end();
      });
      stop = () => {
        off();
        clearInterval(ping);
        unlist();
        stop = () => {};
      };
      req.signal.addEventListener("abort", end);
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
