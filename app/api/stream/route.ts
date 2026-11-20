// Live picture for the war room: one snapshot, then every change, as server-sent events.
import { room } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const core = room();
  const enc = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (data: unknown) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { stop(); } };
      send({ t: "reset", picture: core.picture() });
      const off = core.subscribe(send);
      const ping = setInterval(() => { try { c.enqueue(enc.encode(": ping\n\n")); } catch { stop(); } }, 15_000);
      stop = () => { off(); clearInterval(ping); };
      req.signal.addEventListener("abort", () => { stop(); try { c.close(); } catch {} });
    },
    cancel() { stop(); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", connection: "keep-alive" } });
}
