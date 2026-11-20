// Sting's core: the common operating picture (agents + entities) and the task board.
// The model follows the open shape of tactical C2 systems (entities, tasks, taskable agents), credited in the README.
// Pure TypeScript, no Node APIs: the server runs one per room, and the hosted demo runs one in the browser.

export type TaskType = "RECON" | "INTEL" | "STRIKE" | "OVERWATCH";
export type TaskStatus = "queued" | "assigned" | "running" | "done" | "failed" | "cancelled";
export type AgentStatus = "ready" | "tasked" | "lost";
export type AgentKind = "mcp" | "house" | "claude-code";

export interface Point { lat: number; lon: number; label?: string }

export interface Agent {
  id: string;
  callsign: string;
  kind: AgentKind;
  /** What the agent says it runs on ("Claude Code · opus", "Codex", "Sting house agent"). */
  platform: string;
  status: AgentStatus;
  /** Where it sits on the map. Agents have no real location: a station is dealt from the callsign. */
  at: Point;
  /** Where it's heading (its task's target). */
  heading?: Point;
  taskId?: string;
  /** 0–1. Agents may report it (tokens or budget left); otherwise it drains a little per task. */
  fuel: number;
  done: number;
  joinedAt: number;
  seenAt: number;
}

export interface TaskLog { at: number; by: string; text: string }

export interface Task {
  id: string;
  /** Short readable id on the board: T-014. */
  code: string;
  type: TaskType;
  title: string;
  brief: string;
  target?: Point;
  status: TaskStatus;
  /** Preferred agent kind or callsign. Empty = any agent. */
  for?: string;
  assignee?: string;
  progress: number;
  log: TaskLog[];
  result?: string;
  orderId?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  url?: string;
  at: Point;
  taskId?: string;
  by: string;
  createdAt: number;
}

export interface Order { id: string; text: string; createdAt: number; taskIds: string[] }

export interface Picture { agents: Agent[]; tasks: Task[]; findings: Finding[]; orders: Order[]; seq: number }

export type Event =
  | { t: "agent"; agent: Agent }
  | { t: "agent-gone"; id: string }
  | { t: "task"; task: Task }
  | { t: "finding"; finding: Finding }
  | { t: "order"; order: Order }
  | { t: "reset"; picture: Picture };

const LOST_AFTER = 3 * 60_000;
const CALLSIGNS = ["WRAITH", "VIPER", "REAPER", "GHOST", "ONYX", "SABER", "HALO", "RAVEN", "TALON", "BANSHEE", "NOMAD", "SPECTRE", "COBRA", "JACKAL", "HAVOC", "ORACLE", "VANTA", "KESTREL", "MANTIS", "AXIOM"];
// Stations dealt around the world (open ocean and ridges, not cities): agents have no real location.
const STATIONS: Point[] = [
  { lat: 38, lon: -40 }, { lat: 12, lon: -150 }, { lat: -32, lon: 70 }, { lat: 52, lon: 165 }, { lat: -48, lon: -20 },
  { lat: 24, lon: 62 }, { lat: 4, lon: -28 }, { lat: -12, lon: 155 }, { lat: 62, lon: -18 }, { lat: 30, lon: 140 },
  { lat: -40, lon: -100 }, { lat: 14, lon: 88 }, { lat: 44, lon: -132 }, { lat: -24, lon: 8 }, { lat: 70, lon: 40 },
];

export const uid = (p = "") => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanBlock = (s: unknown, max: number) => String(s ?? "").replace(/\r/g, "").trim().slice(0, max);

export function validPoint(p: unknown): Point | undefined {
  const o = p as Partial<Point> | null;
  if (!o || typeof o !== "object") return undefined;
  const lat = Number(o.lat), lon = Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon, ...(o.label ? { label: clean(o.label, 60) } : {}) };
}
const TYPES: TaskType[] = ["RECON", "INTEL", "STRIKE", "OVERWATCH"];
export const asType = (t: unknown): TaskType => (TYPES.includes(String(t).toUpperCase() as TaskType) ? (String(t).toUpperCase() as TaskType) : "RECON");

export class Core {
  agents = new Map<string, Agent>();
  tasks = new Map<string, Task>();
  findings: Finding[] = [];
  orders: Order[] = [];
  seq = 0;
  private taskNo = 0;
  private subs = new Set<(e: Event) => void>();
  private waiters = new Set<() => void>();

  constructor(p?: Partial<Picture>) { if (p) this.load(p); }

  load(p: Partial<Picture>) {
    this.agents = new Map((p.agents ?? []).map((a) => [a.id, a]));
    this.tasks = new Map((p.tasks ?? []).map((t) => [t.id, t]));
    this.findings = p.findings ?? [];
    this.orders = p.orders ?? [];
    this.seq = p.seq ?? 0;
    this.taskNo = Math.max(0, ...[...this.tasks.values()].map((t) => Number(t.code.slice(2)) || 0));
  }

  picture(): Picture {
    this.sweep();
    return { agents: [...this.agents.values()], tasks: [...this.tasks.values()], findings: this.findings.slice(-300), orders: this.orders.slice(-50), seq: this.seq };
  }

  subscribe(fn: (e: Event) => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit(e: Event) { this.seq++; for (const fn of this.subs) fn(e); if (e.t === "task") for (const w of [...this.waiters]) w(); }

  // ---- agents ---------------------------------------------------------------------------------------------------
  join(input: { id?: string; callsign?: string; platform?: string; kind?: AgentKind }): Agent {
    const existing = input.id ? this.agents.get(input.id) : undefined;
    const now = Date.now();
    if (existing) { existing.seenAt = now; if (existing.status === "lost") existing.status = existing.taskId ? "tasked" : "ready"; this.emit({ t: "agent", agent: existing }); return existing; }
    const n = this.agents.size;
    const taken = new Set([...this.agents.values()].map((a) => a.callsign));
    let callsign = clean(input.callsign, 24).toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!callsign || taken.has(callsign)) {
      const base = CALLSIGNS[n % CALLSIGNS.length]!;
      let i = 1; while (taken.has(`${base}-${i}`)) i++;
      callsign = `${base}-${i}`;
    }
    const station = STATIONS[n % STATIONS.length]!;
    const agent: Agent = {
      id: input.id || uid("a_"), callsign, kind: input.kind ?? "mcp", platform: clean(input.platform, 48) || "MCP agent",
      status: "ready", at: { lat: station.lat + (Math.random() - .5) * 6, lon: station.lon + (Math.random() - .5) * 6 },
      fuel: 1, done: 0, joinedAt: now, seenAt: now,
    };
    this.agents.set(agent.id, agent);
    this.emit({ t: "agent", agent });
    return agent;
  }

  touch(agentId: string, patch?: { fuel?: number }) {
    const a = this.agents.get(agentId);
    if (!a) return undefined;
    a.seenAt = Date.now();
    if (patch?.fuel != null && Number.isFinite(patch.fuel)) a.fuel = clamp(patch.fuel, 0, 1);
    if (a.status === "lost") { a.status = a.taskId ? "tasked" : "ready"; this.emit({ t: "agent", agent: a }); }
    return a;
  }

  leave(agentId: string) {
    const a = this.agents.get(agentId);
    if (!a) return;
    if (a.taskId) this.requeue(a.taskId, `${a.callsign} left`);
    this.agents.delete(agentId);
    this.emit({ t: "agent-gone", id: agentId });
  }

  /** Agents that went quiet are marked lost and their task goes back on the board. */
  sweep() {
    const now = Date.now();
    for (const a of this.agents.values()) {
      if (a.status !== "lost" && now - a.seenAt > LOST_AFTER) {
        a.status = "lost";
        if (a.taskId) { this.requeue(a.taskId, `${a.callsign} went quiet`); a.taskId = undefined; a.heading = undefined; }
        this.emit({ t: "agent", agent: a });
      }
    }
  }

  // ---- tasks ----------------------------------------------------------------------------------------------------
  createTask(input: { type?: unknown; title?: unknown; brief?: unknown; target?: unknown; for?: unknown; orderId?: string }, by: string): Task {
    const now = Date.now();
    const title = clean(input.title, 120);
    if (!title) throw new Error("A task needs a title.");
    const task: Task = {
      id: uid("t_"), code: `T-${String(++this.taskNo).padStart(3, "0")}`, type: asType(input.type), title,
      brief: cleanBlock(input.brief, 4000), target: validPoint(input.target), status: "queued",
      ...(input.for ? { for: clean(input.for, 24) } : {}),
      progress: 0, log: [{ at: now, by, text: "Queued" }], orderId: input.orderId, createdBy: by, createdAt: now, updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.emit({ t: "task", task });
    return task;
  }

  addOrder(text: string, taskIds: string[], id = uid("o_")): Order {
    const order = { id, text: clean(text, 400), createdAt: Date.now(), taskIds };
    this.orders.push(order);
    this.emit({ t: "order", order });
    return order;
  }

  private fits(t: Task, a: Agent) {
    if (!t.for) return true;
    const f = t.for.toUpperCase();
    return f === a.callsign || f === a.kind.toUpperCase() || (f === "CLAUDE-CODE" && a.kind === "claude-code");
  }

  /** The next queued task this agent can take, assigned to it. Oldest first, its own named tasks before open ones. */
  claim(agentId: string): Task | undefined {
    const a = this.touch(agentId);
    if (!a) throw new Error("Unknown agent. Call sting_join first.");
    if (a.taskId) { const cur = this.tasks.get(a.taskId); if (cur && (cur.status === "assigned" || cur.status === "running")) return cur; }
    const queued = [...this.tasks.values()].filter((t) => t.status === "queued" && this.fits(t, a)).sort((x, y) => Number(!!y.for) - Number(!!x.for) || x.createdAt - y.createdAt);
    const t = queued[0];
    if (!t) return undefined;
    const now = Date.now();
    t.status = "assigned"; t.assignee = a.id; t.updatedAt = now; t.log.push({ at: now, by: a.callsign, text: "Claimed" });
    a.status = "tasked"; a.taskId = t.id; a.heading = t.target;
    this.emit({ t: "task", task: t });
    this.emit({ t: "agent", agent: a });
    return t;
  }

  /** Resolves when any task changes (or after ms). The MCP listen tool long-polls on this. */
  waitForTask(ms: number): Promise<void> {
    return new Promise((res) => {
      const done = () => { clearTimeout(timer); this.waiters.delete(done); res(); };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  update(taskId: string, by: string, patch: { status?: TaskStatus; progress?: number; note?: string; result?: string }): Task {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`No task ${taskId}.`);
    const agent = this.agents.get(by);
    const name = agent?.callsign ?? by;
    if (agent) this.touch(agent.id);
    if (agent && t.assignee && t.assignee !== agent.id) throw new Error(`${t.code} belongs to another agent.`);
    const now = Date.now();
    if (patch.progress != null && Number.isFinite(patch.progress)) t.progress = clamp(patch.progress, 0, 1);
    if (patch.status) {
      const s = patch.status;
      if (!["queued", "assigned", "running", "done", "failed", "cancelled"].includes(s)) throw new Error(`Unknown status ${s}.`);
      t.status = s;
      if (s === "done") t.progress = 1;
      t.log.push({ at: now, by: name, text: s === "running" ? "Executing" : s === "done" ? "Complete" : s === "failed" ? "Failed" : s === "cancelled" ? "Cancelled" : s });
    }
    if (patch.note) t.log.push({ at: now, by: name, text: clean(patch.note, 400) });
    if (patch.result) t.result = cleanBlock(patch.result, 12000);
    if (t.log.length > 60) t.log.splice(1, t.log.length - 60);
    t.updatedAt = now;
    if (t.status === "done" || t.status === "failed" || t.status === "cancelled") {
      const a = t.assignee ? this.agents.get(t.assignee) : undefined;
      if (a && a.taskId === t.id) {
        a.taskId = undefined; a.status = a.status === "lost" ? "lost" : "ready";
        if (t.status === "done") { a.done++; if (a.kind !== "mcp" || patch.status) a.fuel = clamp(a.fuel - 0.04, 0.05, 1); }
        if (t.target) a.at = { lat: t.target.lat, lon: t.target.lon };
        a.heading = undefined;
        this.emit({ t: "agent", agent: a });
      }
    } else if (t.status === "running" && t.assignee) {
      const a = this.agents.get(t.assignee);
      if (a) { a.status = "tasked"; a.taskId = t.id; a.heading = t.target; }
    }
    this.emit({ t: "task", task: t });
    return t;
  }

  private requeue(taskId: string, why: string) {
    const t = this.tasks.get(taskId);
    if (!t || t.status === "done" || t.status === "failed" || t.status === "cancelled") return;
    t.status = "queued"; t.assignee = undefined; t.progress = 0; t.updatedAt = Date.now();
    t.log.push({ at: t.updatedAt, by: "sting", text: `Back on the board: ${why}` });
    this.emit({ t: "task", task: t });
  }

  cancel(taskId: string, by: string) { return this.update(taskId, by, { status: "cancelled" }); }

  // ---- findings ---------------------------------------------------------------------------------------------------
  publish(input: { title?: unknown; detail?: unknown; url?: unknown; at?: unknown; taskId?: string }, by: string): Finding {
    const title = clean(input.title, 140);
    if (!title) throw new Error("A finding needs a title.");
    const agent = this.agents.get(by);
    const task = input.taskId ? this.tasks.get(input.taskId) : agent?.taskId ? this.tasks.get(agent.taskId) : undefined;
    let at = validPoint(input.at) ?? task?.target ?? agent?.heading ?? agent?.at ?? { lat: 0, lon: 0 };
    // Several findings at one target fan out a little so each pin stays clickable.
    const near = this.findings.filter((f) => Math.abs(f.at.lat - at.lat) < 0.5 && Math.abs(f.at.lon - at.lon) < 0.5).length;
    if (near) { const ang = near * 2.4, r = 0.9 + near * 0.35; at = { ...at, lat: clamp(at.lat + Math.sin(ang) * r, -85, 85), lon: ((at.lon + Math.cos(ang) * r + 540) % 360) - 180 }; }
    const url = clean(input.url, 500);
    const f: Finding = {
      id: uid("f_"), title, detail: cleanBlock(input.detail, 3000), ...(/^https?:\/\//.test(url) ? { url } : {}),
      at, taskId: task?.id, by: agent?.callsign ?? by, createdAt: Date.now(),
    };
    this.findings.push(f);
    if (this.findings.length > 500) this.findings.splice(0, this.findings.length - 500);
    if (agent) this.touch(agent.id);
    this.emit({ t: "finding", finding: f });
    return f;
  }

  /** A short text summary of the picture, for agents. */
  brief(): string {
    const p = this.picture();
    const open = p.tasks.filter((t) => t.status === "queued" || t.status === "assigned" || t.status === "running");
    const lines = [
      `${p.agents.filter((a) => a.status !== "lost").length} agents online, ${open.length} open tasks, ${p.findings.length} findings.`,
      ...open.slice(0, 20).map((t) => `${t.code} [${t.type}] ${t.status}${t.assignee ? ` by ${this.agents.get(t.assignee)?.callsign ?? "?"}` : ""}: ${t.title}`),
      ...p.findings.slice(-8).map((f) => `finding by ${f.by}: ${f.title}`),
    ];
    return lines.join("\n");
  }

  clear() {
    this.tasks.clear(); this.findings = []; this.orders = []; this.taskNo = 0;
    for (const a of this.agents.values()) { a.taskId = undefined; a.heading = undefined; if (a.status === "tasked") a.status = "ready"; }
    this.emit({ t: "reset", picture: this.picture() });
  }
}

/** Applies one event to a client-side copy of the picture. */
export function apply(p: Picture, e: Event): Picture {
  switch (e.t) {
    case "reset": return e.picture;
    case "agent": { const agents = p.agents.filter((a) => a.id !== e.agent.id); agents.push(e.agent); return { ...p, agents }; }
    case "agent-gone": return { ...p, agents: p.agents.filter((a) => a.id !== e.id) };
    case "task": { const i = p.tasks.findIndex((t) => t.id === e.task.id); const tasks = p.tasks.slice(); if (i < 0) tasks.push(e.task); else tasks[i] = e.task; return { ...p, tasks }; }
    case "finding": return { ...p, findings: [...p.findings.slice(-299), e.finding] };
    case "order": return { ...p, orders: [...p.orders.slice(-49), e.order] };
  }
}
