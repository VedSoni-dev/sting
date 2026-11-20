"use client";
// The war room's map: a dot-matrix globe on a 2D canvas. Land dots, live aircraft, satellites on real orbits,
// quakes, and the swarm (agents, their routes, task targets, findings). Drag to turn, scroll or pinch to zoom.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import * as sat from "satellite.js";
import type { Agent, Finding, Point, Task } from "@/lib/core";

export interface Aircraft { id: string; cs: string | null; type: string | null; lat: number; lon: number; alt: number | null; gs: number | null; trk: number | null; mil: boolean; t0: number }
export interface Quake { id: string; mag: number; place: string; time: number; url: string; lat: number; lon: number; depth: number }
export interface Sat { name: string; rec: sat.SatRec; group: string; lat: number; lon: number; alt: number; ok: boolean }
export type Layers = { air: boolean; sats: boolean; quakes: boolean; swarm: boolean };

export type Pick =
  | { kind: "agent"; id: string } | { kind: "task"; id: string } | { kind: "finding"; id: string }
  | { kind: "aircraft"; id: string } | { kind: "sat"; id: string } | { kind: "quake"; id: string };

export interface Scene {
  agents: Agent[]; tasks: Task[]; findings: Finding[];
  aircraft: Map<string, Aircraft>; sats: Sat[]; quakes: Quake[];
  layers: Layers; selected: Pick | null; newFindings: Map<string, number>;
}
export interface GlobeHandle { flyTo(p: Point, zoom?: number): void; view(): { lat: number; lon: number; zoom: number } }

const RAD = Math.PI / 180;
const C = { accent: "#ff4d00", fg: "#f2f2f0", dim: "#8a8a85", line: "#262624", mil: "#9cc3ff", civ: "#6f6f6a", sat: "#d8d8d0", quake: "#ff5c5c", land: [200, 200, 192] };

type Anim = { from: Point; to: Point; start: number; dur: number; pos: Point; bearing: number };

export const Globe = forwardRef<GlobeHandle, { scene: React.RefObject<Scene>; onPick: (p: Pick | null) => void; onView?: (v: { lat: number; lon: number; zoom: number }) => void; className?: string }>(
function Globe({ scene, onPick, onView, className = "" }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ lon: -20, lat: 22, zoom: 1, vlon: 0.012, idleAt: 0, fly: null as null | { from: [number, number, number]; to: [number, number, number]; start: number; dur: number } });
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const viewCb = useRef(onView); viewCb.current = onView;

  useImperativeHandle(ref, () => ({
    flyTo(p, zoom) {
      const v = view.current;
      let dl = p.lon - v.lon; dl = ((dl + 540) % 360) - 180;
      v.fly = { from: [v.lon, v.lat, v.zoom], to: [v.lon + dl, Math.max(-70, Math.min(70, p.lat)), zoom ?? Math.max(v.zoom, 1.6)], start: performance.now(), dur: 1100 };
      v.idleAt = performance.now();
    },
    view: () => ({ lat: view.current.lat, lon: view.current.lon, zoom: view.current.zoom }),
  }), []);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, alive = true;
    let land: Float32Array | null = null; // [cosLat, sinLat, lon(rad)] per dot
    let coast: GeoJSON.MultiLineString | null = null;
    const anims = new Map<string, Anim>();
    let hits: { x: number; y: number; r: number; p: Pick; z: number }[] = [];
    let lastSat = 0;

    fetch("/land.json").then((r) => r.json()).then((a: number[]) => {
      const f = new Float32Array((a.length / 2) * 3);
      for (let i = 0, j = 0; i < a.length; i += 2, j += 3) { f[j] = Math.cos(a[i]! * RAD); f[j + 1] = Math.sin(a[i]! * RAD); f[j + 2] = a[i + 1]! * RAD; }
      land = f;
    }).catch(() => {});
    import("world-atlas/land-110m.json").then(async (topo) => {
      const { mesh } = await import("topojson-client");
      const t = (topo as unknown as { default?: unknown }).default ?? topo;
      coast = mesh(t as never, (t as { objects: { land: never } }).objects.land) as GeoJSON.MultiLineString;
    }).catch(() => {});

    const resize = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);

    // ---- projection (orthographic, by hand for the dots; d3 for lines) ----
    const R = () => Math.min(W, H) * 0.42 * view.current.zoom;
    let cl0 = 0, sl0 = 0, cp0 = 1, sp0 = 0, cx = 0, cy = 0, rad = 1;
    const setup = () => { const v = view.current; cl0 = Math.cos(v.lon * RAD); sl0 = Math.sin(v.lon * RAD); cp0 = Math.cos(v.lat * RAD); sp0 = Math.sin(v.lat * RAD); cx = W / 2; cy = H / 2; rad = R(); };
    /** Screen point for lat/lon at radius r (1 = surface). Returns null when hidden behind the earth. */
    const proj = (lat: number, lon: number, r = 1): [number, number, number] | null => {
      const cl = Math.cos(lat * RAD), sl = Math.sin(lat * RAD), lam = lon * RAD;
      const cdl = Math.cos(lam) * cl0 + Math.sin(lam) * sl0, sdl = Math.sin(lam) * cl0 - Math.cos(lam) * sl0;
      const z = sp0 * sl + cp0 * cl * cdl; // cos of angular distance from the centre
      const x = cl * sdl, y = cp0 * sl - sp0 * cl * cdl;
      if (r <= 1.0001 ? z < 0 : z < 0 && x * x * r * r + y * y * r * r < 1) return null;
      return [cx + x * rad * r, cy - y * rad * r, z];
    };
    const d3proj = () => geoOrthographic().rotate([-view.current.lon, -view.current.lat]).translate([cx, cy]).scale(rad).clipAngle(90).precision(0.6);

    const pos = (a: Agent, now: number): Anim => {
      const target = a.heading ?? a.at;
      let an = anims.get(a.id);
      if (!an) { an = { from: a.at, to: target, start: now, dur: 1, pos: a.at, bearing: 90 }; anims.set(a.id, an); }
      if (an.to.lat !== target.lat || an.to.lon !== target.lon) {
        const dist = Math.hypot(target.lat - an.pos.lat, target.lon - an.pos.lon);
        an.from = an.pos; an.to = target; an.start = now; an.dur = reduce ? 1 : Math.min(5200, 1400 + dist * 22);
      }
      const k = Math.min(1, (now - an.start) / an.dur);
      const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const ip = geoInterpolate([an.from.lon, an.from.lat], [an.to.lon, an.to.lat]);
      const [lon, lat] = ip(e);
      let p = { lat, lon };
      if (k >= 1 && !a.heading && a.status !== "lost" && !reduce) {
        // loiter: a slow small circle round the station
        const ph = (now / 9000 + a.id.charCodeAt(2)) % (Math.PI * 2);
        p = { lat: lat + Math.sin(ph) * 0.9, lon: lon + Math.cos(ph) * 0.9 / Math.max(.2, Math.cos(lat * RAD)) };
      }
      const [lon2, lat2] = ip(Math.min(1, e + 0.02));
      if (k < 1) an.bearing = Math.atan2((lon2 - lon) * Math.cos(lat * RAD), lat2 - lat) / RAD;
      else if (!a.heading) an.bearing = (now / 9000 * 57.3 + 90) % 360;
      an.pos = { lat, lon };
      return { ...an, pos: p };
    };

    const label = (t: string, x: number, y: number, color: string, size = 10, align: CanvasTextAlign = "left") => {
      ctx.font = `500 ${size}px ui-monospace, "Geist Mono", monospace`;
      ctx.textAlign = align; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(10,10,10,.78)";
      const w = ctx.measureText(t).width;
      const bx = align === "left" ? x - 3 : align === "right" ? x - w - 3 : x - w / 2 - 3;
      ctx.fillRect(bx, y - size / 2 - 3, w + 6, size + 6);
      ctx.fillStyle = color; ctx.fillText(t, x, y + 0.5);
    };

    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const s = scene.current; if (!s) return;
      const v = view.current;
      if (v.fly) {
        const k = Math.min(1, (now - v.fly.start) / v.fly.dur), e = 1 - Math.pow(1 - k, 3);
        v.lon = v.fly.from[0] + (v.fly.to[0] - v.fly.from[0]) * e; v.lat = v.fly.from[1] + (v.fly.to[1] - v.fly.from[1]) * e; v.zoom = v.fly.from[2] + (v.fly.to[2] - v.fly.from[2]) * e;
        if (k >= 1) v.fly = null;
      } else if (!reduce && !drag && now - v.idleAt > 6000 && !s.selected) v.lon += v.vlon * (16 / 16);
      v.lon = ((v.lon + 540) % 360) - 180;
      setup();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      hits = [];

      // atmosphere + disk
      const glow = ctx.createRadialGradient(cx, cy, rad * 0.9, cx, cy, rad * 1.25);
      glow.addColorStop(0, "rgba(255,77,0,0.10)"); glow.addColorStop(1, "rgba(255,77,0,0)");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.25, 0, Math.PI * 2); ctx.fill();
      const disk = ctx.createRadialGradient(cx - rad * .3, cy - rad * .35, rad * .1, cx, cy, rad);
      disk.addColorStop(0, "#151514"); disk.addColorStop(1, "#0b0b0b");
      ctx.fillStyle = disk; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.lineWidth = 1; ctx.stroke();

      const P = d3proj(); const path = geoPath(P, ctx);
      ctx.beginPath(); path(geoGraticule10()); ctx.strokeStyle = "rgba(255,255,255,.045)"; ctx.lineWidth = .6; ctx.stroke();

      // land dots, shaded towards the limb
      if (land) {
        const ds = Math.max(1.1, Math.min(2.6, rad / 260));
        for (let j = 0; j < land.length; j += 3) {
          const cl = land[j]!, sl = land[j + 1]!, lam = land[j + 2]!;
          const cdl = Math.cos(lam) * cl0 + Math.sin(lam) * sl0;
          const z = sp0 * sl + cp0 * cl * cdl; if (z < 0.02) continue;
          const sdl = Math.sin(lam) * cl0 - Math.cos(lam) * sl0;
          const x = cx + cl * sdl * rad, y = cy - (cp0 * sl - sp0 * cl * cdl) * rad;
          if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
          const a = 0.16 + z * 0.5;
          ctx.fillStyle = `rgba(${C.land[0]},${C.land[1]},${C.land[2]},${a.toFixed(2)})`;
          ctx.fillRect(x - ds / 2, y - ds / 2, ds, ds);
        }
      }
      if (coast) { ctx.beginPath(); path(coast); ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = .7; ctx.stroke(); }

      // quakes
      if (s.layers.quakes) for (const q of s.quakes) {
        const p = proj(q.lat, q.lon); if (!p) continue;
        const r = 2 + Math.pow(q.mag, 1.6) * 0.9 * Math.min(2, v.zoom * .8 + .4);
        const ph = reduce ? 0 : ((now / 2400 + q.time % 1000 / 1000) % 1);
        ctx.strokeStyle = `rgba(255,92,92,${(0.55 * (1 - ph)).toFixed(2)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p[0], p[1], r * (1 + ph), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "rgba(255,92,92,.8)"; ctx.beginPath(); ctx.arc(p[0], p[1], 1.6, 0, Math.PI * 2); ctx.fill();
        hits.push({ x: p[0], y: p[1], r: Math.max(8, r), p: { kind: "quake", id: q.id }, z: 1 });
      }

      // aircraft, dead-reckoned from their last report
      if (s.layers.air) {
        const tnow = Date.now();
        for (const a of s.aircraft.values()) {
          let lat = a.lat, lon = a.lon;
          if (a.gs && a.trk != null && a.alt !== 0) {
            const dt = Math.min(120, (tnow - a.t0) / 1000), nm = (a.gs * dt) / 3600;
            lat += (nm / 60) * Math.cos(a.trk * RAD); lon += ((nm / 60) * Math.sin(a.trk * RAD)) / Math.max(.2, Math.cos(lat * RAD));
          }
          const p = proj(lat, lon, 1.004); if (!p) continue;
          const sel = s.selected?.kind === "aircraft" && s.selected.id === a.id;
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(((a.trk ?? 0) * RAD));
          ctx.fillStyle = a.mil ? C.mil : C.civ;
          const sz = a.mil ? 3.4 : 2.4;
          ctx.beginPath(); ctx.moveTo(0, -sz * 1.4); ctx.lineTo(sz, sz); ctx.lineTo(0, sz * .45); ctx.lineTo(-sz, sz); ctx.closePath(); ctx.fill();
          ctx.restore();
          if (a.mil && (v.zoom > 2.4 || sel) && a.cs) label(a.cs, p[0] + 7, p[1], C.mil, 9);
          hits.push({ x: p[0], y: p[1], r: 7, p: { kind: "aircraft", id: a.id }, z: a.mil ? 2 : 1 });
        }
      }

      // satellites (propagated once a second)
      if (s.layers.sats && s.sats.length) {
        if (now - lastSat > 1000) {
          lastSat = now;
          const d = new Date(), gmst = sat.gstime(d);
          for (const o of s.sats) {
            const pv = sat.propagate(o.rec, d);
            const eci = pv && typeof pv.position === "object" ? pv.position : null;
            if (!eci) { o.ok = false; continue; }
            const geo = sat.eciToGeodetic(eci as sat.EciVec3<number>, gmst);
            o.lat = sat.degreesLat(geo.latitude); o.lon = sat.degreesLong(geo.longitude); o.alt = geo.height; o.ok = Number.isFinite(o.lat);
          }
        }
        for (let i = 0; i < s.sats.length; i++) {
          const o = s.sats[i]!; if (!o.ok) continue;
          const r = 1 + Math.min(o.alt, 40000) / 6371;
          const p = proj(o.lat, o.lon, r); if (!p) continue;
          const star = o.group === "starlink";
          const big = o.group === "stations";
          ctx.fillStyle = star ? "rgba(216,216,208,.45)" : big ? C.fg : "rgba(216,216,208,.85)";
          const z = big ? 3.2 : star ? 1.1 : 1.6;
          ctx.fillRect(p[0] - z / 2, p[1] - z / 2, z, z);
          if (big && /ISS|TIANHE|CSS/i.test(o.name) && o.name.length < 22) label(o.name.replace(/\s*\(.*\)/, ""), p[0] + 6, p[1], C.fg, 9);
          if (!star || v.zoom > 2) hits.push({ x: p[0], y: p[1], r: 6, p: { kind: "sat", id: String(i) }, z: 1 });
        }
        // the selected satellite's orbit, ±50 minutes
        if (s.selected?.kind === "sat") {
          const o = s.sats[Number(s.selected.id)];
          if (o) {
            ctx.beginPath(); let pen = false;
            const t0 = Date.now(), gm = (d: Date) => sat.gstime(d);
            for (let m = -50; m <= 50; m += 1) {
              const d = new Date(t0 + m * 60000), pv = sat.propagate(o.rec, d);
              const e = pv && typeof pv.position === "object" ? pv.position : null; if (!e) { pen = false; continue; }
              const g = sat.eciToGeodetic(e as sat.EciVec3<number>, gm(d));
              const p = proj(sat.degreesLat(g.latitude), sat.degreesLong(g.longitude), 1 + g.height / 6371);
              if (!p) { pen = false; continue; }
              if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
            }
            ctx.strokeStyle = "rgba(242,242,240,.5)"; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
          }
        }
      }

      if (s.layers.swarm) {
        const open = s.tasks.filter((t) => t.target && (t.status === "queued" || t.status === "assigned" || t.status === "running"));
        const byId = new Map(s.agents.map((a) => [a.id, a]));
        const placed = new Map<string, Anim>();
        for (const a of s.agents) placed.set(a.id, pos(a, now));

        // routes: agent → its task target, a dashed great circle that marches
        for (const t of open) {
          const a = t.assignee ? byId.get(t.assignee) : undefined; const an = a && placed.get(a.id);
          if (!a || !an || !t.target) continue;
          ctx.beginPath(); path({ type: "LineString", coordinates: [[an.pos.lon, an.pos.lat], [t.target.lon, t.target.lat]] });
          ctx.strokeStyle = "rgba(255,77,0,.55)"; ctx.lineWidth = 1.2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = reduce ? 0 : -now / 60; ctx.stroke(); ctx.setLineDash([]);
        }
        // task targets: corner brackets that turn slowly
        for (const t of open) {
          const p = proj(t.target!.lat, t.target!.lon); if (!p) continue;
          const live = t.status !== "queued";
          const sel = s.selected?.kind === "task" && s.selected.id === t.id;
          const r = sel ? 13 : 10, ang = reduce ? 0 : (now / 3000) % (Math.PI * 2) * (live ? 1 : .4);
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang);
          ctx.strokeStyle = live ? C.accent : "rgba(242,242,240,.7)"; ctx.lineWidth = 1.4;
          for (let q = 0; q < 4; q++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(r, r - 4); ctx.lineTo(r, r); ctx.lineTo(r - 4, r); ctx.stroke(); }
          ctx.restore();
          ctx.fillStyle = live ? C.accent : C.fg; ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
          label(`${t.code} ${t.type}`, p[0] + r + 6, live ? p[1] + 12 : p[1], live ? C.accent : C.fg, 9.5); // live: below, clear of the agent's callsign
          hits.push({ x: p[0], y: p[1], r: 14, p: { kind: "task", id: t.id }, z: 3 });
        }
        // findings: diamonds, the new ones ping
        for (const f of s.findings) {
          const p = proj(f.at.lat, f.at.lon); if (!p) continue;
          const born = s.newFindings.get(f.id); const age = born ? (now - born) / 1600 : 9;
          if (age < 1 && !reduce) { ctx.strokeStyle = `rgba(255,77,0,${(1 - age).toFixed(2)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], 6 + age * 26, 0, Math.PI * 2); ctx.stroke(); }
          const sel = s.selected?.kind === "finding" && s.selected.id === f.id;
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.PI / 4);
          ctx.fillStyle = sel ? C.accent : "#0a0a0a"; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.3;
          ctx.fillRect(-3.5, -3.5, 7, 7); ctx.strokeRect(-3.5, -3.5, 7, 7); ctx.restore();
          if (sel || v.zoom > 2.2) label(f.title.length > 38 ? f.title.slice(0, 37) + "…" : f.title, p[0] + 9, p[1], C.fg, 9);
          hits.push({ x: p[0], y: p[1], r: 9, p: { kind: "finding", id: f.id }, z: 4 });
        }
        // agents: chevrons with callsigns
        for (const a of s.agents) {
          const an = placed.get(a.id)!; const p = proj(an.pos.lat, an.pos.lon, 1.01); if (!p) continue;
          const sel = s.selected?.kind === "agent" && s.selected.id === a.id;
          const col = a.status === "lost" ? C.dim : a.status === "tasked" ? C.accent : C.fg;
          if (a.status === "tasked" && !reduce) { const ph = (now / 1400) % 1; ctx.strokeStyle = `rgba(255,77,0,${(0.5 * (1 - ph)).toFixed(2)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], 8 + ph * 14, 0, Math.PI * 2); ctx.stroke(); }
          if (sel) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, Math.PI * 2); ctx.stroke(); }
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(an.bearing * RAD);
          ctx.fillStyle = col; ctx.strokeStyle = "#0a0a0a"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 2.5); ctx.lineTo(-6, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
          ctx.restore();
          label(a.callsign, p[0] + 11, p[1] - 12, col, 10);
          hits.push({ x: p[0], y: p[1], r: 13, p: { kind: "agent", id: a.id }, z: 5 });
        }
      }

      // selected aircraft / quake ring
      if (s.selected && (s.selected.kind === "aircraft" || s.selected.kind === "quake" || s.selected.kind === "sat")) {
        const h = hits.find((x) => x.p.kind === s.selected!.kind && x.p.id === s.selected!.id);
        if (h) { ctx.strokeStyle = C.accent; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(h.x, h.y, 11, 0, Math.PI * 2); ctx.stroke(); }
      }
    };
    raf = requestAnimationFrame(frame);

    // ---- input: drag to turn, wheel / pinch to zoom, click to pick ----
    let drag = false, moved = 0, last = { x: 0, y: 0 };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch0 = 0, zoom0 = 1;
    const clampZoom = (z: number) => Math.max(0.8, Math.min(14, z));
    const notify = () => viewCb.current?.({ lat: view.current.lat, lon: view.current.lon, zoom: view.current.zoom });
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = true; moved = 0; last = { x: e.clientX, y: e.clientY }; view.current.fly = null; view.current.idleAt = performance.now();
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a!.x - b!.x, a!.y - b!.y); zoom0 = view.current.zoom; }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        // hover cursor
        const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
        cv.style.cursor = hits.some((h) => Math.hypot(h.x - x, h.y - y) < h.r) ? "pointer" : "grab";
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y); if (pinch0) view.current.zoom = clampZoom(zoom0 * d / pinch0); moved += 10; return; }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.28 / view.current.zoom;
      view.current.lon -= dx * k; view.current.lat = Math.max(-80, Math.min(80, view.current.lat + dy * k));
      view.current.idleAt = performance.now();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0;
      if (pointers.size) return;
      drag = false; notify();
      if (moved < 6) {
        const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
        const near = hits.filter((h) => Math.hypot(h.x - x, h.y - y) < h.r).sort((a, b) => b.z - a.z || Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
        pickRef.current(near[0]?.p ?? null);
      }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); view.current.fly = null; view.current.zoom = clampZoom(view.current.zoom * Math.exp(-e.deltaY * 0.0015)); view.current.idleAt = performance.now(); clearTimeout(wt); wt = setTimeout(notify, 250); };
    let wt: ReturnType<typeof setTimeout> | undefined;
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up); cv.removeEventListener("wheel", wheel); };
  }, [scene]);

  return <canvas ref={canvas} className={className} style={{ touchAction: "none", cursor: "grab", display: "block", width: "100%", height: "100%" }} aria-label="Live map: drag to turn, scroll to zoom" role="img" />;
});
