// The server's war room: one Core per process, kept in .sting/state.json between restarts.
// Sting's live room runs on your own computer (npm run dev / npx sting). The hosted copy runs the demo room in the
// browser instead, because a serverless host can't hold a live room in memory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Core } from "./core";

export const hosted = () => !!process.env.VERCEL;

const DIR = join(process.cwd(), ".sting");
const FILE = join(DIR, "state.json");
const g = globalThis as unknown as { __sting?: Core; __stingSave?: ReturnType<typeof setTimeout> };

export function room(): Core {
  if (g.__sting) return g.__sting;
  const core = new Core();
  try { if (existsSync(FILE)) core.load(JSON.parse(readFileSync(FILE, "utf8"))); } catch { /* a broken file starts a fresh room */ }
  core.subscribe(() => {
    if (hosted()) return;
    clearTimeout(g.__stingSave);
    g.__stingSave = setTimeout(() => {
      try { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(core.picture())); } catch { /* read-only disk: keep it in memory */ }
    }, 400);
  });
  setInterval(() => core.sweep(), 20_000).unref?.();
  g.__sting = core;
  return core;
}

/** Optional shared secret: set STING_TOKEN to require `Authorization: Bearer <token>` on the agent endpoints. */
export function authorized(req: Request): boolean {
  const token = process.env.STING_TOKEN;
  if (!token) return true;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("token");
  return got === token;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
export function fail(e: unknown, status = 400) {
  return json({ error: e instanceof Error ? e.message : String(e) }, status);
}
