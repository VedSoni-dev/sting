// Precomputes the dot-matrix land of the globe: points on a roughly equal-area grid that fall on land.
// node scripts/land-dots.mjs → public/land.json ([lat, lon, lat, lon, …], one decimal)
import { readFileSync, writeFileSync } from "node:fs";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
const topo = JSON.parse(readFileSync("node_modules/world-atlas/land-50m.json", "utf8"));
const land = feature(topo, topo.objects.land);
const step = Number(process.argv[2] ?? 0.75), out = [];
for (let lat = -84; lat <= 84; lat += step) {
  const lonStep = step / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  for (let lon = -180; lon < 180; lon += lonStep)
    if (geoContains(land, [lon, lat])) out.push(Math.round(lat * 10) / 10, Math.round(lon * 10) / 10);
}
writeFileSync("public/land.json", JSON.stringify(out));
console.log(`${out.length / 2} land dots`);
