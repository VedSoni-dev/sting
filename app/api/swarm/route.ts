// Deploy / recall real Claude Code agents on this computer (local runs only).
import { hosted, json, fail } from "@/lib/server";
import { launch, recall, running } from "@/lib/swarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localOnly = (req: Request) => {
  const h = new URL(req.url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
};

export async function POST(req: Request) {
  if (hosted() || !localOnly(req)) return fail("Claude Code agents launch only when Sting runs on your computer.", 409);
  const { count } = (await req.json().catch(() => ({}))) as { count?: number };
  const origin = new URL(req.url).origin;
  try { return json({ launched: launch(Number(count) || 3, `${origin}/api/mcp`, process.env.STING_TOKEN), running: running() }); }
  catch (e) { return fail(e); }
}

export async function DELETE(req: Request) {
  if (hosted() || !localOnly(req)) return fail("Nothing to recall here.", 409);
  return json({ recalled: recall() });
}
