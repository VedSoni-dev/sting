// Launches real Claude Code agents on this computer that join the war room over MCP (local runs only).
// Each one is `claude -p` with only Sting's tools plus web search and fetch: it can't run commands or edit files.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const g = globalThis as unknown as { __stingSwarm?: Map<number, { child: ChildProcess; callsign: string; at: number }> };
const procs = (g.__stingSwarm ??= new Map());
const NAMES = ["VIPER", "REAPER", "GHOST", "ONYX", "SABER", "HALO", "RAVEN", "TALON", "BANSHEE", "NOMAD", "SPECTRE", "COBRA"];

export function claudePath(): string | null {
  try { return execFileSync("/bin/sh", ["-lc", "command -v claude"], { encoding: "utf8", timeout: 4000 }).trim() || null; } catch { return null; }
}

export const running = () => procs.size;

export function launch(count: number, mcpUrl: string, token?: string): string[] {
  const bin = claudePath();
  if (!bin) throw new Error("Claude Code isn't installed here. Install it (npm i -g @anthropic-ai/claude-code), sign in, then try again.");
  const n = Math.max(1, Math.min(12, Math.floor(count)));
  if (procs.size + n > 12) throw new Error(`At most 12 Claude Code agents at once (${procs.size} running).`);
  const cwd = join(tmpdir(), "sting-swarm");
  mkdirSync(cwd, { recursive: true });
  const config = JSON.stringify({ mcpServers: { sting: { type: "http", url: mcpUrl, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) } } });
  const used = new Set([...procs.values()].map((p) => p.callsign));
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 60; i++) {
    const callsign = `${NAMES[i % NAMES.length]}-${Math.floor(i / NAMES.length) + 2}`;
    if (used.has(callsign)) continue;
    used.add(callsign);
    const prompt = `You are ${callsign}, a Claude Code agent in the Sting war room. Call sting_join with callsign "${callsign}" and platform "Claude Code", then follow the work loop it gives you: take tasks with sting_next_task, research them with WebSearch and WebFetch, pin findings with sting_publish (with lat/lon when a finding has a place), and report each task done with a short result. Keep each task under about 6 tool calls. Stop after 3 empty waits in a row, then call sting_leave.`;
    const child = spawn(/*turbopackIgnore: true*/ bin, ["-p", prompt, "--mcp-config", config, "--strict-mcp-config",
      "--allowedTools", "mcp__sting__sting_join,mcp__sting__sting_next_task,mcp__sting__sting_report,mcp__sting__sting_publish,mcp__sting__sting_create_task,mcp__sting__sting_picture,mcp__sting__sting_leave,WebSearch,WebFetch",
      "--disallowedTools", "Bash,Edit,Write,NotebookEdit"], { cwd, stdio: "ignore", env: { ...process.env } });
    const pid = child.pid ?? Math.random();
    procs.set(pid, { child, callsign, at: Date.now() });
    child.on("exit", () => procs.delete(pid));
    child.on("error", () => procs.delete(pid));
    out.push(callsign);
  }
  return out;
}

export function recall(): number {
  const n = procs.size;
  for (const p of procs.values()) { try { p.child.kill("SIGTERM"); } catch {} }
  procs.clear();
  return n;
}
