// COMMAND: turns the operator's order into tasks. Streams the model's JSON so the war room can show it thinking.
import { streamText } from "@/kit/ai";
import { COMMANDER, commanderInput } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { order, agents } = (await req.json().catch(() => ({}))) as { order?: string; agents?: string[] };
  const text = String(order ?? "").trim().slice(0, 1000);
  if (!text) return Response.json({ error: "Give an order first." }, { status: 400 });
  const names = (Array.isArray(agents) ? agents : []).slice(0, 30).map((a) => String(a).slice(0, 40));
  return streamText(req, { system: COMMANDER, messages: [{ role: "user", content: commanderInput(text, names) }], tier: "balanced", json: true });
}
