// Sting's MCP server (Streamable HTTP, JSON responses). Any MCP client joins the war room as an agent:
//   claude mcp add --transport http sting http://localhost:3000/api/mcp
// Each MCP session is one agent on the map. Tools mirror a tactical C2 loop: join, take a task, report, publish.
import { room, authorized, hosted } from "@/lib/server";
import type { Task } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const g = globalThis as unknown as { __stingSessions?: Map<string, string> };
const sessions = (g.__stingSessions ??= new Map<string, string>()); // session id → agent id

const INSTRUCTIONS = `You are an agent in Sting, a war room where one operator commands many AI agents.
Work loop:
1. sting_join once (pick a short callsign if you like).
2. sting_next_task. It waits up to wait_seconds for a task and returns it already assigned to you.
3. sting_report status "running", then do the task with your own tools (search, read, code).
4. sting_publish 1-3 findings as you go: short title, the facts, a source url, and lat/lon if the finding has a place.
5. sting_report status "done" with a result: what you found or did, in a few lines.
6. Go back to 2. Keep going until the operator tells you to stop, or after 3 empty waits in a row.
You can also give other agents work with sting_create_task (split big tasks), and read the board with sting_picture.
Refuse tasks that would hurt, stalk or dox people or attack systems the operator doesn't own; report them "failed" with why.`;

const point = { lat: { type: "number", description: "Latitude of the place this is about, if any" }, lon: { type: "number", description: "Longitude" } };
const TOOLS = [
  { name: "sting_join", description: "Join the Sting war room as an agent. Call once at the start. Returns your callsign and the work loop.",
    inputSchema: { type: "object", properties: { callsign: { type: "string", description: "Short callsign, e.g. VIPER-2. Optional." }, platform: { type: "string", description: "What you are, e.g. 'Claude Code', 'Codex', 'Cursor'." } } } },
  { name: "sting_next_task", description: "Take the next task from the board. Waits up to wait_seconds for one. The task comes back assigned to you.",
    inputSchema: { type: "object", properties: { wait_seconds: { type: "number", description: "How long to wait for a task, 0-50. Default 25." } } } },
  { name: "sting_report", description: "Report on your task: status running/done/failed, progress 0-1, a short note, and on done the result.",
    inputSchema: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" }, status: { type: "string", enum: ["running", "done", "failed"] }, progress: { type: "number" }, note: { type: "string", description: "One line for the task log." }, result: { type: "string", description: "On done: what you found or did." } } } },
  { name: "sting_publish", description: "Pin a finding on the operator's map: a fact, a lead, a link, a file you made.",
    inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string" }, detail: { type: "string" }, url: { type: "string" }, task_id: { type: "string" }, ...point } } },
  { name: "sting_create_task", description: "Put a new task on the board for any agent (or one callsign). Use it to split big work across the swarm.",
    inputSchema: { type: "object", required: ["title"], properties: { type: { type: "string", enum: ["RECON", "INTEL", "STRIKE", "OVERWATCH"] }, title: { type: "string" }, brief: { type: "string" }, target_label: { type: "string" }, ...point, for: { type: "string", description: "A callsign, to give it to one agent." } } } },
  { name: "sting_picture", description: "Read the board: agents online, open tasks, recent findings.", inputSchema: { type: "object", properties: {} } },
  { name: "sting_leave", description: "Leave the war room. Your open task goes back on the board.", inputSchema: { type: "object", properties: {} } },
];

type RPC = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const ok = (id: RPC["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: RPC["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (s: string, isError = false) => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });

function taskText(t: Task) {
  return [`${t.code} [${t.type}] ${t.title}`, `task_id: ${t.id}`, t.brief && `brief: ${t.brief}`, t.target && `target: ${t.target.label ?? ""} (${t.target.lat.toFixed(2)}, ${t.target.lon.toFixed(2)})`].filter(Boolean).join("\n");
}

async function call(sessionId: string, name: string, a: Record<string, unknown>, platformHint: string) {
  const core = room();
  const agentId = () => {
    let id = sessions.get(sessionId);
    if (!id || !core.agents.has(id)) { id = core.join({ platform: platformHint, kind: "mcp" }).id; sessions.set(sessionId, id); }
    return id;
  };
  switch (name) {
    case "sting_join": {
      const prev = sessions.get(sessionId);
      if (prev && core.agents.has(prev)) { const a0 = core.touch(prev)!; return text(`Already in. You are ${a0.callsign}.\n\n${INSTRUCTIONS}`); }
      const agent = core.join({ callsign: a.callsign as string, platform: (a.platform as string) || platformHint, kind: "mcp" });
      sessions.set(sessionId, agent.id);
      return text(`You are ${agent.callsign}. You're on the map.\n\n${INSTRUCTIONS}\n\nBoard now:\n${core.brief()}`);
    }
    case "sting_next_task": {
      const id = agentId();
      const wait = Math.min(50, Math.max(0, Number(a.wait_seconds ?? 25) || 0)) * 1000;
      const until = Date.now() + wait;
      for (;;) {
        const t = core.claim(id);
        if (t) return text(`New task for ${core.agents.get(id)?.callsign}:\n${taskText(t)}\n\nReport "running", do it, publish findings, then report "done" with a result.`);
        const left = until - Date.now();
        if (left <= 0) return text("No task yet. Call sting_next_task again to keep waiting.");
        await core.waitForTask(Math.min(left, 10_000));
        core.touch(id);
      }
    }
    case "sting_report": {
      const id = agentId();
      const status = a.status as "running" | "done" | "failed" | undefined;
      if (status && !["running", "done", "failed"].includes(status)) return text(`status must be running, done or failed.`, true);
      const t = core.update(String(a.task_id), id, { status, progress: a.progress as number, note: a.note as string, result: a.result as string });
      return text(`${t.code} is ${t.status}.${t.status === "done" ? " Call sting_next_task for the next one." : ""}`);
    }
    case "sting_publish": {
      const id = agentId();
      const f = core.publish({ title: a.title, detail: a.detail, url: a.url, taskId: a.task_id as string, at: a.lat != null ? { lat: a.lat, lon: a.lon } : undefined }, id);
      return text(`Pinned: ${f.title} (${f.at.lat.toFixed(2)}, ${f.at.lon.toFixed(2)}).`);
    }
    case "sting_create_task": {
      const id = agentId();
      const by = core.agents.get(id)?.callsign ?? "agent";
      const t = core.createTask({ type: a.type, title: a.title, brief: a.brief, for: a.for, target: a.lat != null ? { lat: a.lat, lon: a.lon, label: a.target_label } : undefined }, by);
      return text(`On the board: ${t.code} ${t.title}`);
    }
    case "sting_picture": agentId(); return text(core.brief());
    case "sting_leave": { const id = sessions.get(sessionId); if (id) core.leave(id); sessions.delete(sessionId); return text("Left the war room."); }
    default: throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
  }
}

async function handle(m: RPC, sessionId: string, platformHint: string) {
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sting", title: "Sting war room", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return ok(m.id, {});
    case "tools/list": return ok(m.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      try { return ok(m.id, await call(sessionId, name, (m.params?.arguments as Record<string, unknown>) ?? {}, platformHint)); }
      catch (e) { const c = (e as { code?: number }).code; return c ? err(m.id, c, (e as Error).message) : ok(m.id, text((e as Error).message, true)); }
    }
    default: return m.id == null ? null : err(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function POST(req: Request) {
  if (hosted()) return Response.json(err(null, -32000, "The hosted copy of Sting has no live room. Run it on your computer: git clone https://github.com/VedSoni-dev/sting.git && cd sting && npm install && npm run dev"), { status: 409 });
  if (!authorized(req)) return Response.json(err(null, -32001, "Unauthorized: send Authorization: Bearer <STING_TOKEN>."), { status: 401 });
  const body = (await req.json().catch(() => null)) as RPC | RPC[] | null;
  if (!body) return Response.json(err(null, -32700, "Parse error"), { status: 400 });
  const msgs = Array.isArray(body) ? body : [body];
  const isInit = msgs.some((m) => m.method === "initialize");
  const sessionId = req.headers.get("mcp-session-id") || (isInit ? crypto.randomUUID() : "anon");
  const ua = req.headers.get("user-agent") ?? "";
  const client = msgs.find((m) => m.method === "initialize")?.params?.clientInfo as { name?: string } | undefined;
  const platformHint = client?.name ?? (/claude/i.test(ua) ? "Claude Code" : "MCP agent");
  if (client?.name) (g as Record<string, unknown>)[`__stingClient:${sessionId}`] = client.name;
  const hint = ((g as Record<string, unknown>)[`__stingClient:${sessionId}`] as string | undefined) ?? platformHint;
  const out = (await Promise.all(msgs.map((m) => handle(m, sessionId, prettyClient(hint))))).filter(Boolean);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (isInit) headers["mcp-session-id"] = sessionId;
  if (!out.length) return new Response(null, { status: 202, headers });
  return Response.json(Array.isArray(body) ? out : out[0], { headers });
}

function prettyClient(n: string) {
  if (/claude-code/i.test(n)) return "Claude Code";
  if (/codex/i.test(n)) return "Codex";
  if (/cursor/i.test(n)) return "Cursor";
  if (/claude/i.test(n)) return "Claude";
  return n.slice(0, 40) || "MCP agent";
}

export async function GET() { return new Response("Sting MCP: POST JSON-RPC here.", { status: 405, headers: { allow: "POST, DELETE" } }); }

export async function DELETE(req: Request) {
  const sid = req.headers.get("mcp-session-id");
  if (sid) { const id = sessions.get(sid); if (id) room().leave(id); sessions.delete(sid); }
  return new Response(null, { status: 204 });
}
