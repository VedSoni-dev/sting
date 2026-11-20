"use client";
// How the war room UI talks to its room: the live room on this computer (SSE + /api/room), or, on the hosted copy,
// a room that lives in this browser tab. Same calls either way.
import { apply, Core, type Agent, type AgentKind, type Event, type Finding, type Picture, type Task, type TaskStatus } from "./core";

export interface Net {
  live: boolean;
  subscribe(fn: (p: Picture, e?: Event) => void): () => void;
  order(text: string, tasks: Record<string, unknown>[]): Promise<Task[]>;
  task(input: Record<string, unknown>): Promise<Task>;
  cancel(id: string): Promise<void>;
  clear(): Promise<void>;
  join(input: { callsign?: string; platform?: string; kind?: AgentKind }): Promise<Agent>;
  leave(id: string): Promise<void>;
  claim(agentId: string): Promise<Task | null>;
  update(id: string, agentId: string, patch: { status?: TaskStatus; progress?: number; note?: string; result?: string }): Promise<Task>;
  publish(agentId: string, f: { title: string; detail?: string; url?: string; taskId?: string }): Promise<Finding>;
  touch(agentId: string): Promise<void>;
  close(): void;
}

const empty: Picture = { agents: [], tasks: [], findings: [], orders: [], seq: 0 };

export function remoteNet(): Net {
  let pic = empty;
  const subs = new Set<(p: Picture, e?: Event) => void>();
  let es: EventSource | null = null;
  const open = () => {
    es = new EventSource("/api/stream");
    es.onmessage = (m) => { try { const e = JSON.parse(m.data) as Event; pic = apply(pic, e); for (const f of subs) f(pic, e); } catch {} };
    es.onerror = () => { /* EventSource reconnects by itself */ };
  };
  open();
  const op = async <T,>(body: Record<string, unknown>): Promise<T> => {
    const r = await fetch("/api/room", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
    return j as T;
  };
  return {
    live: true,
    subscribe(fn) { subs.add(fn); fn(pic); return () => { subs.delete(fn); }; },
    order: async (text, tasks) => (await op<{ tasks: Task[] }>({ op: "order", text, tasks })).tasks,
    task: async (input) => (await op<{ task: Task }>({ op: "task", ...input })).task,
    cancel: async (id) => { await op({ op: "cancel", id }); },
    clear: async () => { await op({ op: "clear" }); },
    join: async (input) => (await op<{ agent: Agent }>({ op: "join", ...input })).agent,
    leave: async (id) => { await op({ op: "leave", id }); },
    claim: async (agentId) => (await op<{ task: Task | null }>({ op: "claim", agentId })).task,
    update: async (id, agentId, patch) => (await op<{ task: Task }>({ op: "update", id, agentId, ...patch })).task,
    publish: async (agentId, f) => (await op<{ finding: Finding }>({ op: "publish", agentId, ...f })).finding,
    touch: async (agentId) => { await op({ op: "touch", agentId }); },
    close() { es?.close(); subs.clear(); },
  };
}

const KEY = "sting:room";
export function localNet(): Net {
  let saved: Partial<Picture> | undefined;
  try { const s = localStorage.getItem(KEY); if (s) saved = JSON.parse(s); } catch {}
  // House agents from an earlier visit aren't running any more: start without them.
  if (saved) saved = { ...saved, agents: [], tasks: (saved.tasks ?? []).map((t) => (t.status === "assigned" || t.status === "running") ? { ...t, status: "queued" as const, assignee: undefined, progress: 0 } : t) };
  const core = new Core(saved);
  let pic = core.picture();
  const subs = new Set<(p: Picture, e?: Event) => void>();
  let t: ReturnType<typeof setTimeout> | undefined;
  const off = core.subscribe((e) => {
    pic = apply(pic, e);
    for (const f of subs) f(pic, e);
    clearTimeout(t); t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(core.picture())); } catch {} }, 500);
  });
  const sweep = setInterval(() => core.sweep(), 20_000);
  return {
    live: false,
    subscribe(fn) { subs.add(fn); fn(pic); return () => { subs.delete(fn); }; },
    order: async (text, tasks) => { const orderId = `o_${Date.now().toString(36)}`; const made = tasks.slice(0, 24).map((x) => core.createTask({ ...x, orderId }, "COMMAND")); core.addOrder(text, made.map((m) => m.id), orderId); return made; },
    task: async (input) => core.createTask(input, "COMMAND"),
    cancel: async (id) => { core.cancel(id, "COMMAND"); },
    clear: async () => core.clear(),
    join: async (input) => core.join({ ...input, kind: input.kind ?? "house" }),
    leave: async (id) => core.leave(id),
    claim: async (agentId) => core.claim(agentId) ?? null,
    update: async (id, agentId, patch) => core.update(id, agentId, patch),
    publish: async (agentId, f) => core.publish(f, agentId),
    touch: async (agentId) => { core.touch(agentId); },
    close() { off(); clearInterval(sweep); subs.clear(); },
  };
}
