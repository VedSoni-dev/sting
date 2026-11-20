// What this copy of Sting can do: a live local room (with MCP and Claude Code agents) or the hosted demo room.
import { hosted, json } from "@/lib/server";
import { claudePath, running } from "@/lib/swarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (hosted()) return json({ live: false, claudeCode: false, swarm: 0, mcpUrl: null });
  const origin = new URL(req.url).origin;
  return json({ live: true, claudeCode: !!claudePath(), swarm: running(), mcpUrl: `${origin}/api/mcp`, token: !!process.env.STING_TOKEN });
}
