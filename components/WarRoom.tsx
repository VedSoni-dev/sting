"use client";
// The war room: the live globe, the swarm (assets), the task board, the intel feed and the order line.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as satjs from "satellite.js";
import { ModeButton } from "@/kit/react/ModePanel";
import { useAI, useStudio } from "@/kit/react/studio";
import { parsePlan } from "@/lib/parse";
import type { Agent, Finding, Picture, Task } from "@/lib/core";
import { localNet, remoteNet, type Net } from "@/lib/net";
import { Globe, type Aircraft, type GlobeHandle, type Layers, type Pick, type Quake, type Sat, type Scene } from "./Globe";

type Info = { live: boolean; claudeCode: boolean; swarm: number; mcpUrl: string | null; token?: boolean };
const EXAMPLES = [
  "Find the 8 fastest-growing AI startups in Europe and what they charge",
  "Scout every free alternative to Notion and rank them",
  "Map where this week's biggest tech layoffs happened",
  "Track rocket launches scheduled this month and who's flying",
];
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
const STATUS_TEXT: Record<Task["status"], string> = { queued: "QUEUED", assigned: "ASSIGNED", running: "EXECUTING", done: "COMPLETE", failed: "FAILED", cancelled: "CANCELLED" };

export function WarRoom() {
  const [info, setInfo] = useState<Info | null>(null);
  const [pic, setPic] = useState<Picture>({ agents: [], tasks: [], findings: [], orders: [], seq: 0 });
  const [selected, setSelected] = useState<Pick | null>(null);
  const [layers, setLayers] = useState<Layers>({ air: true, sats: true, quakes: true, swarm: true });
  const [starlink, setStarlink] = useState(false);
  const [tab, setTab] = useState<"tasks" | "intel">("tasks");
  const [mobileTab, setMobileTab] = useState<"map" | "assets" | "board">("map");
  const [connect, setConnect] = useState(false);
  const [counts, setCounts] = useState({ air: 0, mil: 0, sats: 0, quakes: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const net = useRef<Net | null>(null);
  const globe = useRef<GlobeHandle>(null);
  const studio = useStudio();
  const scene = useRef<Scene>({ agents: [], tasks: [], findings: [], aircraft: new Map(), sats: [], quakes: [], layers, selected: null, newFindings: new Map() });

  // ---- the room ----
  useEffect(() => {
    let n: Net | null = null; let off = () => {};
    fetch("/api/info").then((r) => r.json()).catch(() => ({ live: false })).then((i: Info) => {
      setInfo(i);
      n = i.live ? remoteNet() : localNet();
      net.current = n;
      off = n.subscribe((p, e) => {
        if (e?.t === "finding") scene.current.newFindings.set(e.finding.id, performance.now());
        if (e?.t === "reset" && i.live) for (const a of e.picture.agents) if (a.kind === "house" && a.status === "lost") void n!.leave(a.id); // house agents from a closed tab
        setPic(p);
      });
    });
    return () => { off(); n?.close(); };
  }, []);
  useEffect(() => { Object.assign(scene.current, { agents: pic.agents, tasks: pic.tasks, findings: pic.findings }); }, [pic]);
  useEffect(() => { scene.current.layers = layers; }, [layers]);
  useEffect(() => { scene.current.selected = selected; }, [selected]);
  const flash = useCallback((t: string) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 3200); }, []);

  // ---- sensors ----
  useEffect(() => {
    let alive = true;
    const air = scene.current.aircraft;
    const take = (list: Omit<Aircraft, "t0">[]) => { const t0 = Date.now(); for (const a of list) if (a.id) air.set(a.id, { ...a, t0 }); };
    const prune = () => { const now = Date.now(); for (const [k, a] of air) if (now - a.t0 > 120_000) air.delete(k); };
    const count = () => { let mil = 0; for (const a of air.values()) if (a.mil) mil++; setCounts((c) => ({ ...c, air: air.size, mil })); };
    const mil = async () => { try { const r = await fetch("/api/sensors?feed=mil"); if (r.ok) take(await r.json()); } catch {} prune(); if (alive) count(); };
    const near = async () => {
      const v = globe.current?.view(); if (!v || v.zoom < 2.2) return;
      try { const r = await fetch(`/api/sensors?feed=air&lat=${Math.round(v.lat)}&lon=${Math.round(v.lon)}`); if (r.ok) take(await r.json()); } catch {}
      if (alive) count();
    };
    const quakes = async () => { try { const r = await fetch("/api/sensors?feed=quakes"); if (r.ok) { scene.current.quakes = (await r.json()) as Quake[]; if (alive) setCounts((c) => ({ ...c, quakes: scene.current.quakes.length })); } } catch {} };
    void mil(); void quakes();
    const a = setInterval(mil, 20_000), b = setInterval(near, 20_000), c = setInterval(quakes, 300_000);
    (scene.current as Scene & { refreshNear?: () => void }).refreshNear = () => void near();
    return () => { alive = false; clearInterval(a); clearInterval(b); clearInterval(c); };
  }, []);
  useEffect(() => {
    let alive = true;
    const groups = ["stations", "visual", "gps-ops", ...(starlink ? ["starlink"] : [])];
    Promise.all(groups.map(async (g) => {
      try { const r = await fetch(`/api/sensors?feed=sats&group=${g}`); if (!r.ok) return []; const tle = (await r.json()) as [string, string, string][];
        return tle.map(([name, l1, l2]) => { try { return { name, rec: satjs.twoline2satrec(l1, l2), group: g, lat: 0, lon: 0, alt: 0, ok: false } as Sat; } catch { return null; } }).filter(Boolean) as Sat[];
      } catch { return []; }
    })).then((lists) => {
      if (!alive) return;
      const seen = new Set<string>(); const all: Sat[] = [];
      for (const l of lists) for (const s of l) if (!seen.has(s.name)) { seen.add(s.name); all.push(s); }
      scene.current.sats = all; setCounts((c) => ({ ...c, sats: all.length }));
    });
    return () => { alive = false; };
  }, [starlink]);

  // ---- house agents (run in this tab, powered by the AI mode picked) ----
  const mine = useRef(new Set<string>());
  const runHouse = useCallback(async (agentId: string, callsign: string) => {
    const n = net.current!;
    let empty = 0;
    while (mine.current.has(agentId)) {
      let task: Task | null = null;
      try { task = await n.claim(agentId); } catch { break; }
      if (!task) { empty++; await new Promise((r) => setTimeout(r, empty > 3 ? 4000 : 1500)); if (empty % 10 === 0) void n.touch(agentId).catch(() => {}); continue; }
      empty = 0;
      try {
        await n.update(task.id, agentId, { status: "running", progress: 0.1, note: "Working it" });
        const res = await fetch("/api/house", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callsign, task }) });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          if (res.status === 401 || res.status === 409 || res.status === 402) studio.openPicker({ message: j.error ?? "Pick how to power the house agents.", action: j.action });
          await n.update(task.id, agentId, { status: "failed", note: j.error ?? `AI said ${res.status}` });
          mine.current.delete(agentId); void n.leave(agentId);
          break;
        }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let all = ""; let ticks = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; all += dec.decode(value, { stream: true }); if (++ticks % 12 === 0) void n.update(task.id, agentId, { progress: Math.min(0.9, 0.15 + all.length / 1600) }).catch(() => {}); }
        const warn = all.lastIndexOf("\n\n⚠ "); if (warn >= 0) throw new Error(all.slice(warn + 4));
        const head = all.match(/HEADLINE:\s*(.+)/i)?.[1]?.trim() ?? all.trim().split("\n")[0]!.slice(0, 90);
        const report = (all.split(/REPORT:\s*/i)[1] ?? all).trim();
        await n.publish(agentId, { title: head, detail: report, taskId: task.id });
        await n.update(task.id, agentId, { status: "done", result: `${head}\n\n${report}` });
      } catch (e) {
        await n.update(task.id, agentId, { status: "failed", note: e instanceof Error ? e.message : "Stopped" }).catch(() => {});
      }
    }
  }, [studio]);
  useEffect(() => () => { mine.current.clear(); }, []);

  const deployHouse = useCallback(async (count: number) => {
    if (!studio.status?.active) { studio.openPicker({ message: "House agents think with the AI you pick. Pick one, then deploy." }); return; }
    const n = net.current; if (!n) return;
    const platform = `House agent · ${studio.status.modes.find((m) => m.id === studio.status!.active)?.label ?? "AI"}`;
    for (let i = 0; i < count; i++) {
      const a = await n.join({ platform, kind: "house" });
      mine.current.add(a.id); void runHouse(a.id, a.callsign);
      await new Promise((r) => setTimeout(r, 160));
    }
    flash(`${count} house agents deployed`);
  }, [studio, runHouse, flash]);
  const recallHouse = useCallback(async () => {
    const ids = [...mine.current]; mine.current.clear();
    for (const id of ids) await net.current?.leave(id).catch(() => {});
  }, []);

  const launchClaude = useCallback(async (count: number) => {
    const r = await fetch("/api/swarm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { flash(j.error ?? "Couldn't launch."); return; }
    flash(`Launching ${j.launched.join(", ")}. They join in a few seconds.`);
    setInfo((i) => (i ? { ...i, swarm: j.running } : i));
  }, [flash]);
  const recallClaude = useCallback(async () => {
    const r = await fetch("/api/swarm", { method: "DELETE" }); const j = await r.json().catch(() => ({}));
    flash(`Recalled ${j.recalled ?? 0} Claude Code agents`); setInfo((i) => (i ? { ...i, swarm: 0 } : i));
  }, [flash]);

  // ---- orders ----
  const command = useAI("/api/order");
  const [orderText, setOrderText] = useState("");
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const giveOrder = useCallback(async (raw: string) => {
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text || command.busy || !net.current) return;
    // "/recon find X" puts one task straight on the board, no planner.
    const direct = text.match(/^\/(recon|intel|strike|overwatch)\s+(.+)/i);
    if (direct) {
      const t = await net.current.task({ type: direct[1]!.toUpperCase(), title: direct[2]!.slice(0, 120), brief: direct[2] });
      setOrderText(""); setSelected({ kind: "task", id: t.id }); setTab("tasks"); return;
    }
    const agents = scene.current.agents.filter((a) => a.status !== "lost").map((a) => `${a.callsign} (${a.platform})`);
    const out = await command.run({ order: text, agents });
    if (!out) return;
    try {
      const plan = parsePlan(out);
      const tasks = plan.tasks;
      setLastSummary(plan.summary ?? null);
      if (!tasks.length) { flash(plan.summary ?? "COMMAND made no tasks."); return; }
      const made = await net.current.order(text, tasks);
      setOrderText(""); setTab("tasks");
      const first = made.find((t) => t.target);
      if (first?.target) globe.current?.flyTo(first.target, 1.5);
      if (!scene.current.agents.some((a) => a.status !== "lost")) flash("Tasks are on the board. Deploy agents to run them.");
    } catch { flash("COMMAND's plan didn't parse. Try the order again."); }
  }, [command, flash]);

  // ---- derived ----
  const online = pic.agents.filter((a) => a.status !== "lost");
  const open = pic.tasks.filter((t) => t.status === "queued" || t.status === "assigned" || t.status === "running");
  const tasksSorted = useMemo(() => [...pic.tasks].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt).slice(0, 80), [pic.tasks]);
  const findingsSorted = useMemo(() => [...pic.findings].reverse().slice(0, 80), [pic.findings]);
  const agentById = useMemo(() => new Map(pic.agents.map((a) => [a.id, a])), [pic.agents]);
  const select = useCallback((p: Pick | null) => {
    setSelected(p);
    if (!p) return;
    if (p.kind === "task") { const t = scene.current.tasks.find((x) => x.id === p.id); if (t?.target) globe.current?.flyTo(t.target); setTab("tasks"); }
    if (p.kind === "finding") { const f = scene.current.findings.find((x) => x.id === p.id); if (f) globe.current?.flyTo(f.at); setTab("intel"); }
  }, []);

  const clock = useClock();

  return (
    <div className="war fixed inset-0 overflow-hidden bg-bg text-fg">
      <Globe ref={globe} scene={scene} onPick={select} className="war-globe" onView={(v) => { if (v.zoom >= 2.2) (scene.current as Scene & { refreshNear?: () => void }).refreshNear?.(); }} />
      <div className="war-vignette pointer-events-none" aria-hidden />

      {/* top bar */}
      <header className="war-top">
        <Link href="/" className="war-brand" aria-label="Sting home"><Mark /><span>STING</span></Link>
        <span className={`war-room ${info?.live ? "is-live" : ""}`}>{info ? (info.live ? "LIVE ROOM · THIS COMPUTER" : "BROWSER ROOM") : "CONNECTING"}</span>
        <div className="war-stats" aria-label="Picture">
          <Stat k="AGENTS" v={online.length} hot={online.length > 0} />
          <Stat k="TASKS" v={open.length} hot={open.length > 0} />
          <Stat k="INTEL" v={pic.findings.length} />
          <Stat k="AIR" v={counts.air} sub={counts.mil ? `${counts.mil} MIL` : undefined} />
          <Stat k="ORBIT" v={counts.sats} />
          <Stat k="SEISMIC" v={counts.quakes} />
        </div>
        <span className="war-clock">{clock}</span>
        <ModeButton className="war-mode" />
      </header>

      <nav className="war-mtabs" aria-label="Panels">
        {(["map", "assets", "board"] as const).map((t) => <button key={t} type="button" className={mobileTab === t ? "is-on" : ""} onClick={() => setMobileTab(t)}>{t.toUpperCase()}</button>)}
      </nav>

      {/* assets */}
      <aside className={`war-panel war-left ${mobileTab === "assets" ? "m-show" : ""}`} aria-label="Assets">
        <div className="war-ph"><h2>ASSETS</h2><span>{online.length} ONLINE</span></div>
        <div className="war-scroll">
          {pic.agents.length === 0 && (
            <div className="war-empty">
              <p className="war-empty-h">No agents in the room.</p>
              <p>Deploy house agents, or connect Claude Code, Codex or any MCP agent. Each one shows up on the map.</p>
            </div>
          )}
          <ul className="war-agents">
            {[...pic.agents].sort((a, b) => Number(a.status === "lost") - Number(b.status === "lost") || a.joinedAt - b.joinedAt).map((a) => (
              <AgentRow key={a.id} a={a} task={a.taskId ? pic.tasks.find((t) => t.id === a.taskId) : undefined} on={selected?.kind === "agent" && selected.id === a.id} onClick={() => select({ kind: "agent", id: a.id })} />
            ))}
          </ul>
        </div>
        <div className="war-actions">
          <button type="button" className="sk-btn war-btn" onClick={() => void deployHouse(3)}>Deploy 3 house agents</button>
          {info?.live && info.claudeCode && (
            <button type="button" className="war-btn-2" onClick={() => void launchClaude(4)}>Launch 4 Claude Code agents</button>
          )}
          <div className="war-row">
            <button type="button" className="war-btn-2" onClick={() => setConnect(true)}>Connect agent</button>
            {(mine.current.size > 0 || (info?.swarm ?? 0) > 0) && <button type="button" className="war-btn-2" onClick={() => { void recallHouse(); if (info?.swarm) void recallClaude(); }}>Recall</button>}
          </div>
        </div>
      </aside>

      {/* board */}
      <aside className={`war-panel war-right ${mobileTab === "board" ? "m-show" : ""}`} aria-label="Board">
        <div className="war-ph war-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "is-on" : ""} onClick={() => setTab("tasks")}>TASKS <span>{open.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === "intel"} className={tab === "intel" ? "is-on" : ""} onClick={() => setTab("intel")}>INTEL <span>{pic.findings.length}</span></button>
          {pic.tasks.length > 0 && <button type="button" className="war-clear" onClick={() => { if (confirm("Clear every task and finding?")) void net.current?.clear(); }}>CLEAR</button>}
        </div>
        <div className="war-scroll">
          {tab === "tasks" ? (
            tasksSorted.length ? <ul className="war-tasks">{tasksSorted.map((t) => (
              <TaskRow key={t.id} t={t} agent={t.assignee ? agentById.get(t.assignee) : undefined} on={selected?.kind === "task" && selected.id === t.id} onClick={() => select({ kind: "task", id: t.id })} />
            ))}</ul> : <div className="war-empty"><p className="war-empty-h">The board is empty.</p><p>Give an order below. COMMAND splits it into tasks and the swarm takes them.</p></div>
          ) : (
            findingsSorted.length ? <ul className="war-intel">{findingsSorted.map((f) => (
              <li key={f.id}><button type="button" className={selected?.kind === "finding" && selected.id === f.id ? "is-on" : ""} onClick={() => select({ kind: "finding", id: f.id })}>
                <span className="war-meta"><b>{f.by}</b> · {ago(f.createdAt)} ago</span><span className="war-title">{f.title}</span>
              </button></li>
            ))}</ul> : <div className="war-empty"><p className="war-empty-h">No intel yet.</p><p>Findings land here and on the map as agents report.</p></div>
          )}
        </div>
      </aside>

      {/* layers */}
      <div className="war-layers" role="group" aria-label="Map layers">
        {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
          <button key={k} type="button" aria-pressed={layers[k]} className={layers[k] ? "is-on" : ""} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}>{k === "air" ? "AIR" : k === "sats" ? "ORBIT" : k === "quakes" ? "SEISMIC" : "SWARM"}</button>
        ))}
        <button type="button" aria-pressed={starlink} className={starlink ? "is-on" : ""} onClick={() => setStarlink((s) => !s)}>STARLINK</button>
      </div>

      {/* selection */}
      {selected && <Detail sel={selected} pic={pic} scene={scene.current} onClose={() => setSelected(null)} onCancel={(id) => void net.current?.cancel(id)} onSelect={select} />}

      {/* order line */}
      <form className="war-order" onSubmit={(e) => { e.preventDefault(); void giveOrder(orderText); }}>
        {(command.busy || command.error || lastSummary) && (
          <div className="war-console" aria-live="polite">
            {command.busy ? <><span className="war-blink">COMMAND ▸</span> {(command.text || "planning").slice(-220)}</>
              : command.error ? <span className="war-err">COMMAND ▸ {command.error.message}</span>
              : <span>COMMAND ▸ {lastSummary}</span>}
          </div>
        )}
        <label htmlFor="order" className="sr-only">Give an order</label>
        <div className="war-order-row">
          <span className="war-prompt" aria-hidden>ORDER ▸</span>
          <input id="order" value={orderText} onChange={(e) => setOrderText(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={EXAMPLES[pic.orders.length % EXAMPLES.length]} />
          {command.busy ? <button type="button" className="war-btn-2" onClick={command.stop}>Abort</button>
            : <button type="submit" className="sk-btn war-btn" disabled={!orderText.trim()}>Execute</button>}
        </div>
        {!pic.orders.length && !command.busy && <div className="war-chips">{EXAMPLES.slice(0, 3).map((x) => <button key={x} type="button" onClick={() => setOrderText(x)}>{x}</button>)}</div>}
      </form>

      {connect && <ConnectDialog info={info} onClose={() => setConnect(false)} />}
      {toast && <div className="war-toast" role="status">{toast}</div>}
    </div>
  );
}

const rank = (t: Task) => ({ running: 0, assigned: 1, queued: 2, failed: 3, done: 4, cancelled: 5 })[t.status];

function Stat({ k, v, sub, hot }: { k: string; v: number; sub?: string; hot?: boolean }) {
  return <span className={`war-stat ${hot ? "is-hot" : ""}`}><i>{k}</i><b>{v.toLocaleString("en-US")}</b>{sub && <em>{sub}</em>}</span>;
}

function Mark() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 2 L14 14 L12 22 L10 14 Z" fill="var(--accent)" /><path d="M6 15h12" stroke="var(--fg)" strokeWidth="1.6" /></svg>;
}

function AgentRow({ a, task, on, onClick }: { a: Agent; task?: Task; on: boolean; onClick: () => void }) {
  return (
    <li><button type="button" className={`war-agent s-${a.status} ${on ? "is-on" : ""}`} onClick={onClick}>
      <span className="war-agent-top"><b>{a.callsign}</b><span className="war-st">{a.status === "tasked" ? (task ? `${task.code} ${task.type}` : "TASKED") : a.status === "lost" ? "NO SIGNAL" : "READY"}</span></span>
      <span className="war-meta">{a.platform} · {a.done} done</span>
      <span className="war-fuel" aria-label={`Fuel ${Math.round(a.fuel * 100)}%`}><i style={{ width: `${Math.round(a.fuel * 100)}%` }} /></span>
    </button></li>
  );
}

function TaskRow({ t, agent, on, onClick }: { t: Task; agent?: Agent; on: boolean; onClick: () => void }) {
  return (
    <li><button type="button" className={`war-task st-${t.status} ${on ? "is-on" : ""}`} onClick={onClick}>
      <span className="war-task-top"><span className="war-code">{t.code}</span><span className={`war-type ty-${t.type}`}>{t.type}</span><span className="war-st">{STATUS_TEXT[t.status]}</span></span>
      <span className="war-title">{t.title}</span>
      <span className="war-meta">{agent ? agent.callsign : t.status === "queued" ? "Waiting for an agent" : "—"}{t.target?.label ? ` · ${t.target.label}` : ""} · {ago(t.updatedAt)}</span>
      {(t.status === "assigned" || t.status === "running") && <span className="war-prog"><i style={{ width: `${Math.round(Math.max(0.04, t.progress) * 100)}%` }} /></span>}
    </button></li>
  );
}

function Detail({ sel, pic, scene, onClose, onCancel, onSelect }: { sel: Pick; pic: Picture; scene: Scene; onClose: () => void; onCancel: (id: string) => void; onSelect: (p: Pick) => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  let body: React.ReactNode = null, title = "", kicker = "";
  if (sel.kind === "task") {
    const t = pic.tasks.find((x) => x.id === sel.id); if (!t) return null;
    const a = t.assignee ? pic.agents.find((x) => x.id === t.assignee) : undefined;
    kicker = `${t.code} · ${t.type} · ${STATUS_TEXT[t.status]}`; title = t.title;
    const fs = pic.findings.filter((f) => f.taskId === t.id);
    body = <>
      {t.brief && <p className="war-d-p">{t.brief}</p>}
      <dl className="war-dl"><dt>Agent</dt><dd>{a ? <button type="button" className="war-link" onClick={() => onSelect({ kind: "agent", id: a.id })}>{a.callsign}</button> : "—"}</dd><dt>Target</dt><dd>{t.target?.label ?? "—"}</dd><dt>Ordered by</dt><dd>{t.createdBy}</dd></dl>
      {t.result && <pre className="war-result">{t.result}</pre>}
      {fs.length > 0 && <ul className="war-d-list">{fs.map((f) => <li key={f.id}><button type="button" className="war-link" onClick={() => onSelect({ kind: "finding", id: f.id })}>◆ {f.title}</button></li>)}</ul>}
      <ol className="war-log">{t.log.slice(-6).map((l, i) => <li key={i}><span>{new Date(l.at).toISOString().slice(11, 19)}Z</span> <b>{l.by}</b> {l.text}</li>)}</ol>
      {(t.status === "queued" || t.status === "assigned" || t.status === "running") && <button type="button" className="war-btn-2" onClick={() => onCancel(t.id)}>Cancel task</button>}
    </>;
  } else if (sel.kind === "finding") {
    const f = pic.findings.find((x) => x.id === sel.id); if (!f) return null;
    kicker = `INTEL · ${f.by} · ${ago(f.createdAt)} AGO`; title = f.title;
    body = <>{f.detail && <pre className="war-result">{f.detail}</pre>}{f.url && <a className="war-link" href={f.url} target="_blank" rel="noopener noreferrer">Source ↗</a>}</>;
  } else if (sel.kind === "agent") {
    const a = pic.agents.find((x) => x.id === sel.id); if (!a) return null;
    const t = a.taskId ? pic.tasks.find((x) => x.id === a.taskId) : undefined;
    kicker = `ASSET · ${a.kind === "house" ? "HOUSE" : a.kind === "claude-code" ? "CLAUDE CODE" : "MCP"}`; title = a.callsign;
    body = <dl className="war-dl"><dt>Runs on</dt><dd>{a.platform}</dd><dt>Status</dt><dd>{a.status.toUpperCase()}</dd><dt>Task</dt><dd>{t ? <button type="button" className="war-link" onClick={() => onSelect({ kind: "task", id: t.id })}>{t.code} {t.title}</button> : "—"}</dd><dt>Done</dt><dd>{a.done}</dd><dt>Fuel</dt><dd>{Math.round(a.fuel * 100)}%</dd><dt>Last heard</dt><dd>{ago(a.seenAt)} ago</dd></dl>;
  } else if (sel.kind === "aircraft") {
    const a = scene.aircraft.get(sel.id); if (!a) return null;
    kicker = a.mil ? "AIR · MILITARY · ADS-B" : "AIR · ADS-B"; title = a.cs ?? a.id.toUpperCase();
    body = <dl className="war-dl"><dt>Type</dt><dd>{a.type ?? "—"}</dd><dt>Altitude</dt><dd>{a.alt == null ? "—" : a.alt === 0 ? "On the ground" : `${a.alt.toLocaleString("en-US")} ft`}</dd><dt>Speed</dt><dd>{a.gs ? `${Math.round(a.gs)} kt` : "—"}</dd><dt>Track</dt><dd>{a.trk != null ? `${Math.round(a.trk)}°` : "—"}</dd><dt>Position</dt><dd>{a.lat.toFixed(2)}, {a.lon.toFixed(2)}</dd><dt>Source</dt><dd>adsb.lol, {ago(a.t0)} ago</dd></dl>;
  } else if (sel.kind === "sat") {
    const s = scene.sats[Number(sel.id)]; if (!s) return null;
    kicker = `ORBIT · ${s.group.toUpperCase()}`; title = s.name;
    body = <dl className="war-dl"><dt>Altitude</dt><dd>{Math.round(s.alt).toLocaleString("en-US")} km</dd><dt>Over</dt><dd>{s.lat.toFixed(1)}, {s.lon.toFixed(1)}</dd><dt>NORAD</dt><dd>{s.rec.satnum}</dd><dt>Source</dt><dd>CelesTrak elements, propagated live</dd></dl>;
  } else if (sel.kind === "quake") {
    const q = scene.quakes.find((x) => x.id === sel.id); if (!q) return null;
    kicker = "SEISMIC · USGS"; title = `M${q.mag.toFixed(1)} · ${q.place}`;
    body = <><dl className="war-dl"><dt>When</dt><dd>{ago(q.time)} ago</dd><dt>Depth</dt><dd>{q.depth.toFixed(0)} km</dd></dl><a className="war-link" href={q.url} target="_blank" rel="noopener noreferrer">USGS event ↗</a></>;
  }
  return (
    <section className="war-detail sk-rise" aria-label="Selected">
      <div className="war-d-head"><span>{kicker}</span><button type="button" className="sk-icon-btn" aria-label="Close" onClick={onClose}>×</button></div>
      <h3>{title}</h3>
      <div className="war-d-body">{body}</div>
    </section>
  );
}

function ConnectDialog({ info, onClose }: { info: Info | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const url = info?.mcpUrl ?? "http://localhost:3000/api/mcp";
  const auth = info?.token ? ` --header "Authorization: Bearer $STING_TOKEN"` : "";
  const rows = [
    { k: "Claude Code", v: `claude mcp add --transport http sting ${url}${auth}` },
    { k: "Codex", v: `codex mcp add sting --url ${url}` },
    { k: "Any MCP client (JSON)", v: JSON.stringify({ mcpServers: { sting: { type: "http", url } } }) },
  ];
  return (
    <dialog ref={ref} className="sk-dialog war-dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="sk-dialog-head"><h2>Connect an agent</h2><button type="button" className="sk-icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>×</button></div>
      {info?.live ? <>
        <p className="sk-muted">Add Sting as an MCP server, then tell the agent: <b className="text-fg">“join the sting war room and work the board”</b>. It shows up on the map.</p>
        <div className="war-conn">{rows.map((r) => <CopyRow key={r.k} label={r.k} value={r.v} />)}</div>
      </> : <>
        <p className="sk-muted">Agents connect to the live room, which runs on your own computer. One command starts it:</p>
        <div className="war-conn"><CopyRow label="Run Sting" value="git clone https://github.com/VedSoni-dev/sting.git && cd sting && npm install && npm run dev" /></div>
        <p className="sk-muted">Then add <code>http://localhost:3000/api/mcp</code> to Claude Code, Codex or any MCP client. Here, house agents run the board with the AI you picked.</p>
      </>}
    </dialog>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="war-copy">
      <span className="war-meta">{label}</span>
      <div><code>{value}</code><button type="button" className="war-btn-2" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1600); }); }}>{ok ? "Copied ✓" : "Copy"}</button></div>
    </div>
  );
}

function useClock() {
  const [t, setT] = useState("");
  useEffect(() => { const f = () => setT(new Date().toISOString().slice(11, 19) + "Z"); f(); const i = setInterval(f, 1000); return () => clearInterval(i); }, []);
  return t;
}
