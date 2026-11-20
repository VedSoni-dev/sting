// A house agent's turn: one task, answered by whichever AI mode this browser picked.
import { streamText } from "@/kit/ai";
import { HOUSE, houseInput } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  const { callsign, task } = (await req.json().catch(() => ({}))) as { callsign?: string; task?: Parameters<typeof houseInput>[0] };
  if (!task?.title) return Response.json({ error: "No task." }, { status: 400 });
  const t = { code: String(task.code ?? ""), type: String(task.type ?? "RECON"), title: String(task.title).slice(0, 200), brief: String(task.brief ?? "").slice(0, 3000), target: task.target };
  return streamText(req, { system: HOUSE(String(callsign ?? "HOUSE-1").slice(0, 24)), messages: [{ role: "user", content: houseInput(t) }], tier: "fast" });
}
