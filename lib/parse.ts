// First JSON value in a model's answer (code fences and a sentence around it are fine). Client-safe copy of the kit's.
export function parseJSONLoose<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  if (start === -1) throw new Error("No JSON in the answer.");
  const open = fenced[start]!, close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < fenced.length; i++) {
    const c = fenced[i]!;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(fenced.slice(start, i + 1)) as T;
  }
  throw new Error("The JSON was cut off.");
}

/** COMMAND's plan. Small local models sometimes repeat the "tasks" key or drop a brace: gather every task array. */
export function parsePlan(text: string): { summary?: string; tasks: Record<string, unknown>[] } {
  let plan: { summary?: string; tasks?: unknown } = {};
  try { plan = parseJSONLoose(text); } catch { /* salvage below */ }
  const arrays: Record<string, unknown>[] = [];
  const re = /"tasks"\s*:\s*\[/g;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    try { const arr = parseJSONLoose<unknown[]>(text.slice(m.index + m[0].length - 1)); for (const x of arr) if (x && typeof x === "object" && (x as { title?: unknown }).title) arrays.push(x as Record<string, unknown>); } catch {}
  }
  const tasks = arrays.length > (Array.isArray(plan.tasks) ? plan.tasks.length : 0) ? arrays : ((plan.tasks as Record<string, unknown>[]) ?? []);
  const summary = plan.summary ?? text.match(/"summary"\s*:\s*"([^"]{0,200})"/)?.[1];
  return { summary, tasks: tasks.slice(0, 12) };
}
