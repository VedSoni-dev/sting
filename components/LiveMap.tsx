"use client";
// The landing page's live globe: the same map as the war room, public feeds only (no swarm).
import { useEffect, useRef } from "react";
import * as satjs from "satellite.js";
import { Globe, type Aircraft, type Quake, type Sat, type Scene } from "./Globe";

export function LiveMap() {
  const scene = useRef<Scene>({ agents: [], tasks: [], findings: [], aircraft: new Map(), sats: [], quakes: [], layers: { air: true, sats: true, quakes: true, swarm: false }, selected: null, newFindings: new Map() });
  useEffect(() => {
    let alive = true;
    const air = async () => { try { const r = await fetch("/api/sensors?feed=mil"); if (r.ok && alive) { const t0 = Date.now(); for (const a of (await r.json()) as Omit<Aircraft, "t0">[]) if (a.id) scene.current.aircraft.set(a.id, { ...a, t0 }); } } catch {} };
    void air();
    fetch("/api/sensors?feed=quakes").then((r) => (r.ok ? r.json() : [])).then((q: Quake[]) => { if (alive) scene.current.quakes = q; }).catch(() => {});
    Promise.all(["stations", "visual"].map((g) => fetch(`/api/sensors?feed=sats&group=${g}`).then((r) => (r.ok ? r.json() : [])).catch(() => []))).then((lists: [string, string, string][][]) => {
      if (!alive) return;
      scene.current.sats = lists.flatMap((l, i) => l.map(([name, l1, l2]) => { try { return { name, rec: satjs.twoline2satrec(l1, l2), group: i ? "visual" : "stations", lat: 0, lon: 0, alt: 0, ok: false } as Sat; } catch { return null; } }).filter(Boolean) as Sat[]);
    });
    const i = setInterval(air, 20_000);
    return () => { alive = false; clearInterval(i); };
  }, []);
  return <Globe scene={scene} onPick={() => {}} />;
}
