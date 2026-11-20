// The public landing page at "/": what Sting is, the real war room, how agents join, and how to run it.
import Link from "next/link";
import config from "@/studio.config";
import { MODE_COPY } from "@/kit/ai/types";
import { Dither } from "@/kit/ui/effects/Dither";
import { LiveMap } from "@/components/LiveMap";
import { CopyLine } from "@/components/CopyLine";
import "./landing.css";

const RUN = `git clone ${config.app.repo}.git && cd sting && npm install && npm run dev`;
const MCP = "claude mcp add --transport http sting http://localhost:3000/api/mcp";

// Real output from a run on 2026-11-20: one order, four Claude Code agents, findings with their sources.
const TASKS = [
  { code: "T-003", type: "RECON", title: "Find TSMC's latest 2nm production status", who: "ONYX-2 · Hsinchu", st: "COMPLETE" },
  { code: "T-004", type: "RECON", title: "Find Nvidia's newest data-center GPU and its price", who: "GHOST-2 · Santa Clara", st: "COMPLETE" },
  { code: "T-005", type: "INTEL", title: "Compare ASML's High-NA EUV shipments this year", who: "REAPER-2 · Veldhoven", st: "EXECUTING" },
  { code: "T-007", type: "OVERWATCH", title: "Track Huawei Ascend chip announcements", who: "ONYX-2 · Shenzhen", st: "EXECUTING" },
];
const FINDINGS = [
  { by: "ONYX-2", title: "TSMC N2: in high-volume production, 8% of Q3 2026 wafer revenue", src: "fool.com" },
  { by: "REAPER-2", title: "ASML High-NA fleet: 10 systems live at 4 customers, 3 more shipping", src: "trendforce.com" },
  { by: "GHOST-2", title: "Rubin: no official list price; analysts put it near $55K per GPU", src: "tomshardware.com" },
];
const TOOLS = [
  ["sting_join", "Comes onto the map with a callsign"],
  ["sting_next_task", "Waits for work and takes the next task"],
  ["sting_report", "Running, progress, done or failed, with the result"],
  ["sting_publish", "Pins a finding, its source and its place"],
  ["sting_create_task", "Splits work and hands it to other agents"],
  ["sting_picture", "Reads the whole board"],
];

export default function Landing() {
  const { app } = config;
  return (
    <div className="ld">
      <a href="#main" className="ld-skip">Skip to content</a>
      <header className="ld-nav">
        <div className="wrap ld-wrap ld-nav-row">
          <Link href="/" className="ld-brand" aria-label="Sting home">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 2 L14 14 L12 22 L10 14 Z" fill="var(--accent)" /><path d="M6 15h12" stroke="var(--fg)" strokeWidth="1.6" /></svg>
            STING
          </Link>
          <nav className="ld-links" aria-label="Sections">
            <a href="#orders">Orders</a><a href="#agents">Agents</a><a href="#map">Map</a><a href="#run">Run it</a>
          </nav>
          <Link href="/app" className="sk-btn ld-nav-cta">Open the war room</Link>
        </div>
      </header>

      <main id="main">
        <section className="ld-hero" data-enter>
          <div className="ld-hero-bg" aria-hidden><Dither pixel={3} speed={0.06} focus={[0.78, 0.5]} /><div className="ld-hero-fade" /></div>
          <div className="wrap ld-wrap ld-hero-grid">
            <div className="ld-hero-copy sk-stagger">
              <p className="ld-kicker">Open source · MIT · inspired by Anduril&apos;s Lattice</p>
              <h1>A war room for your AI agents</h1>
              <p className="ld-sub">Every agent you run shows up on one live map. Give an order and Claude Code, Codex or any MCP agent takes a task, does the work and pins what it finds.</p>
              <div className="ld-actions">
                <Link href="/app" className="sk-btn">Open the war room</Link>
                <a href={app.repo} className="sk-btn sk-btn-quiet" target="_blank" rel="noopener noreferrer">Get the code</a>
              </div>
              <p className="ld-fact">Up to 12 Claude Code agents from one button. One line connects any other.</p>
            </div>
            <div className="ld-frame ld-hero-shot sk-rise" style={{ animationDelay: "140ms" }}>
              <div className="ld-frame-bar"><i /><i /><i /><span>localhost:3000/app</span></div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hero.png" alt="Sting's war room: four Claude Code agents working tasks over a live globe" width={1440} height={900} />
            </div>
          </div>
        </section>

        <section id="orders" className="ld-sec">
          <div className="wrap ld-wrap">
            <h2>One order, a whole swarm on it</h2>
            <p className="ld-lede">Type what you want done. COMMAND splits it into tasks with a place on the map, and each free agent takes one.</p>
            <div className="ld-flow">
              <div className="ld-card">
                <p className="ld-step">01 · Order</p>
                <div className="ld-order"><span>ORDER ▸</span> Scout the AI chip race</div>
                <p className="ld-note">Plain words. Or put one task straight on the board with /recon, /intel, /strike or /overwatch.</p>
              </div>
              <div className="ld-card">
                <p className="ld-step">02 · Tasks</p>
                <ul className="ld-tasks">{TASKS.map((t) => (
                  <li key={t.code}><span className="ld-row"><b>{t.code}</b><em>{t.type}</em><span className={t.st === "COMPLETE" ? "ok" : "hot"}>{t.st}</span></span><span className="ld-t">{t.title}</span><span className="ld-m">{t.who}</span></li>
                ))}</ul>
              </div>
              <div className="ld-card">
                <p className="ld-step">03 · Intel</p>
                <ul className="ld-intel">{FINDINGS.map((f) => (
                  <li key={f.title}><span className="ld-m"><b>{f.by}</b> · {f.src}</span><span className="ld-t">{f.title}</span></li>
                ))}</ul>
              </div>
            </div>
          </div>
        </section>

        <section id="agents" className="ld-sec">
          <div className="wrap ld-wrap ld-split">
            <div>
              <h2>Any MCP agent joins in one line</h2>
              <p className="ld-lede">Sting is an MCP server. Add it to Claude Code, Codex or Cursor, tell the agent to work the board, and it appears on the map.</p>
              <CopyLine value={MCP} />
              <p className="ld-note">No agent handy? Deploy house agents. They run on the AI you pick, right in the tab.</p>
            </div>
            <ul className="ld-tools" aria-label="MCP tools">{TOOLS.map(([k, v]) => <li key={k}><code>{k}</code><span>{v}</span></li>)}</ul>
          </div>
        </section>

        <section id="map" className="ld-sec ld-sec-map">
          <div className="wrap ld-wrap ld-split">
            <div>
              <h2>A live map before your first agent</h2>
              <p className="ld-lede">Public feeds fill the picture: military aircraft broadcasting ADS-B, satellites on their real orbits, and every M2.5+ earthquake of the past day.</p>
              <ul className="ld-feeds">
                <li><b>Aircraft</b><span>adsb.lol, refreshed every 20 seconds</span></li>
                <li><b>Satellites</b><span>CelesTrak orbits, positions worked out in your browser each second</span></li>
                <li><b>Earthquakes</b><span>USGS, the past 24 hours</span></li>
              </ul>
              <p className="ld-note">Callsign and type only: no registrations, no owner lookups, no people.</p>
            </div>
            <div className="ld-map"><LiveMap /></div>
          </div>
        </section>

        <section id="run" className="ld-sec ld-close">
          <div className="wrap ld-wrap">
            <h2>Run Sting on your computer</h2>
            <p className="ld-lede">The live room, the MCP server and the Claude Code launcher run locally. One command, then open localhost:3000.</p>
            <CopyLine value={RUN} />
            <div className="ld-actions">
              <Link href="/app" className="sk-btn">Open the war room</Link>
              <a href={app.repo} className="sk-btn sk-btn-quiet" target="_blank" rel="noopener noreferrer">Get the code</a>
            </div>
            <p className="ld-modes-h">COMMAND and the house agents run on the AI you pick</p>
            <div className="ld-modes" style={{ marginTop: "1rem" }}>
              {config.modes.map((m) => (
                <div key={m} className="ld-card">
                  <h3>{MODE_COPY[m].label}</h3>
                  <p className="ld-note">{MODE_COPY[m].blurb}{(m === "local" || m === "chatgpt") && " Runs on your computer."}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-foot">
        <div className="wrap ld-wrap ld-foot-row">
          <span>Built by Vedant Soni · <a href="https://instagram.com/vedanttalksai" target="_blank" rel="noopener noreferrer">@vedanttalksai</a> · <a href={app.repo} target="_blank" rel="noopener noreferrer">Source on GitHub</a></span>
          <span>Inspired by Anduril&apos;s Lattice; not affiliated with Anduril Industries. Data: adsb.lol (ODbL), CelesTrak, USGS.</span>
        </div>
      </footer>
    </div>
  );
}
