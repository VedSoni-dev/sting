// Public sensor feeds, cached and trimmed, for the map's live layers.
//   ?feed=mil              military aircraft broadcasting ADS-B worldwide (adsb.lol, ODbL)
//   ?feed=air&lat=&lon=    all aircraft within 250 nm of a point (adsb.lol)
//   ?feed=sats&group=      orbital elements (CelesTrak): stations, visual, gps-ops, starlink
//   ?feed=quakes           M2.5+ earthquakes, past day (USGS)
// Aircraft are shown by callsign and type only: no registration, no owner lookups.
export const runtime = "nodejs";

const UA = { "user-agent": "Sting/0.1 (open-source war room; github.com/VedSoni-dev/sting)" };
const g = globalThis as unknown as { __stingCache?: Map<string, { at: number; body: string }> };
const cache = (g.__stingCache ??= new Map());

async function cached(key: string, ttl: number, load: () => Promise<unknown>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  try {
    const body = JSON.stringify(await load());
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return body;
  } catch (e) {
    if (hit) return hit.body; // stale beats empty
    throw e;
  }
}

type AC = { hex?: string; flight?: string; t?: string; lat?: number; lon?: number; alt_baro?: number | string; gs?: number; track?: number; dbFlags?: number; squawk?: string };
const trim = (list: AC[], mil: boolean) => list.filter((a) => typeof a.lat === "number" && typeof a.lon === "number").map((a) => ({
  id: a.hex, cs: (a.flight ?? "").trim() || null, type: a.t ?? null, lat: +a.lat!.toFixed(4), lon: +a.lon!.toFixed(4),
  alt: typeof a.alt_baro === "number" ? a.alt_baro : a.alt_baro === "ground" ? 0 : null, gs: a.gs ?? null, trk: a.track ?? null,
  mil: mil || ((a.dbFlags ?? 0) & 1) === 1,
}));

async function getJSON(url: string) {
  const r = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} said ${r.status}`);
  return r.json();
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const feed = u.searchParams.get("feed");
  try {
    let body: string;
    if (feed === "mil") body = await cached("mil", 20_000, async () => trim(((await getJSON("https://api.adsb.lol/v2/mil")) as { ac: AC[] }).ac ?? [], true));
    else if (feed === "air") {
      const lat = Math.round(Number(u.searchParams.get("lat")) || 0), lon = Math.round(Number(u.searchParams.get("lon")) || 0);
      if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return Response.json({ error: "bad point" }, { status: 400 });
      body = await cached(`air:${lat}:${lon}`, 20_000, async () => trim(((await getJSON(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/250`)) as { ac: AC[] }).ac ?? [], false));
    } else if (feed === "sats") {
      const group = u.searchParams.get("group") ?? "visual";
      if (!["stations", "visual", "gps-ops", "starlink", "weather", "geo"].includes(group)) return Response.json({ error: "unknown group" }, { status: 400 });
      body = await cached(`sats:${group}`, 6 * 3600_000, async () => {
        const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`celestrak said ${r.status}`);
        const lines = (await r.text()).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
        const out: [string, string, string][] = [];
        for (let i = 0; i + 2 < lines.length; i += 3) if (lines[i + 1]!.startsWith("1 ") && lines[i + 2]!.startsWith("2 ")) out.push([lines[i]!.trim(), lines[i + 1]!, lines[i + 2]!]);
        return out;
      });
    } else if (feed === "quakes") body = await cached("quakes", 5 * 60_000, async () => {
      const j = (await getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson")) as { features: { id: string; properties: { mag: number; place: string; time: number; url: string }; geometry: { coordinates: number[] } }[] };
      return j.features.map((f) => ({ id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time, url: f.properties.url, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: f.geometry.coordinates[2] }));
    });
    else return Response.json({ error: "feed must be mil, air, sats or quakes" }, { status: 400 });
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=15" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "feed down" }, { status: 502 });
  }
}
