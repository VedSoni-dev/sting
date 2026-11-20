// Drives a real run for tools/capture.mjs (README media, reel B-roll). Start from an empty room:
//   rm -f .sting/state.json && npm run build && npx next start -p 3001
//   node tools/capture.mjs http://localhost:3001 --steps apps/sting/capture.steps.mjs --out apps/sting/docs/media --video
// Reel shots (DESIGN.md): the live globe before anything happens; an order → tasks bracket cities; a Claude Code swarm
// flies to them and pins drop. COMMAND runs on whatever mode is ready (local llama3.2 works for this order).
export default async function ({ page, go, click, type, wait, shot }) {
  const count = (sel) => page.locator(sel).count();
  const until = async (fn, ms = 180000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await page.waitForTimeout(700); } };

  // 1. The map is live before any agent: military aircraft, satellites, quakes.
  await go("/app");
  await until(async () => Number((await page.locator(".war-stat:has-text('AIR') b").innerText().catch(() => "0")).replace(/,/g, "")) > 20, 30000);
  await wait(2500);
  await shot("screen-1");

  // 2. One order: COMMAND splits it into tasks with targets on the map.
  await type("#order", "Scout the AI chip race: TSMC, Nvidia, ASML, Samsung and Huawei", { delay: 26 });
  await click('button:has-text("Execute")');
  await until(async () => (await count(".war-task")) >= 3, 120000);
  await wait(2600);
  await shot("screen-2");

  // 3. Launch a swarm of real Claude Code agents. They join over MCP and fly to their targets.
  await click('button:has-text("Launch 4 Claude Code agents")');
  await until(async () => (await count(".war-agent.s-tasked")) >= 3, 120000);
  await wait(5000);
  await shot("screen-3");

  // 4. Intel comes back with sources and lands on the map.
  await until(async () => (await count(".war-task.st-done")) >= 3, 240000);
  await click('button[role="tab"]:has-text("INTEL")');
  await wait(800);
  await click(".war-intel li:first-child button");
  await wait(2200);
  await shot("screen-4");

  // The landing, last.
  await go("/");
  await wait(1500);
  await shot("cover", { cover: true });
  await shot("screen-5");
}
