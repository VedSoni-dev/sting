// The commander's controls over the local room (the war room UI calls these). Agents use /api/mcp instead.
import { room, json, fail, hosted } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { op?: string; [k: string]: unknown };

export async function POST(req: Request) {
  if (hosted()) return fail("The hosted copy runs its room in your browser. Run Sting locally for a live room.", 409);
  const b = (await req.json().catch(() => ({}))) as Body;
  const core = room();
  try {
    switch (b.op) {
      case "order": {
        const tasks = (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 24) as Record<string, unknown>[];
        const orderId = `o_${Date.now().toString(36)}`;
        const made = tasks.map((t) => core.createTask({ ...t, orderId }, "COMMAND"));
        core.addOrder(String(b.text ?? ""), made.map((t) => t.id), orderId);
        return json({ ok: true, tasks: made });
      }
      case "task": return json({ task: core.createTask(b as Record<string, unknown>, "COMMAND") });
      case "cancel": return json({ task: core.cancel(String(b.id), "COMMAND") });
      case "clear": core.clear(); return json({ ok: true });
      case "join": return json({ agent: core.join({ callsign: b.callsign as string, platform: b.platform as string, kind: (b.kind as "house") ?? "house" }) });
      case "leave": core.leave(String(b.id)); return json({ ok: true });
      case "claim": return json({ task: core.claim(String(b.agentId)) ?? null });
      case "update": return json({ task: core.update(String(b.id), String(b.agentId), b as never) });
      case "publish": return json({ finding: core.publish(b as never, String(b.agentId)) });
      case "touch": core.touch(String(b.agentId)); return json({ ok: true });
      default: return fail(`Unknown op ${b.op}.`);
    }
  } catch (e) { return fail(e); }
}
