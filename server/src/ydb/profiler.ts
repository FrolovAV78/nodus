import type { GlobalProfile, LevelProfile, NodeHit, ValueProfile, YdbDriver } from "./types.ts";

const DELIMS = ["|", "^", "~", ";", ",", "\t"];

function classifySubscript(v: string | number): string {
  const s = String(v);
  if (typeof v === "number" || /^-?\d+$/.test(s)) return "integer";
  if (/^-?\d+\.\d+$/.test(s)) return "decimal";
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{8}$/.test(s)) return "date";
  if (/^[A-Z]{1,4}-?\d+$/i.test(s) || /^[A-Z]+\d+$/.test(s)) return "code";
  return "string";
}

function guessValue(samples: string[]): Omit<ValueProfile, "samples"> & { samples: string[] } {
  const stats = {
    empty: 0,
    numeric: 0,
    json: 0,
    delimited: 0,
    other: 0,
    delimiterGuess: null as string | null,
    pieceCountGuess: null as number | null,
    samples: samples.slice(0, 16),
  };
  const delimHits = new Map<string, { count: number; pieces: number }>();
  for (const raw of samples) {
    const s = raw ?? "";
    if (s === "") {
      stats.empty += 1;
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      stats.numeric += 1;
      continue;
    }
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        JSON.parse(s);
        stats.json += 1;
        continue;
      } catch {
        /* fallthrough */
      }
    }
    let best: { d: string; n: number } | null = null;
    for (const d of DELIMS) {
      if (!s.includes(d)) continue;
      const n = s.split(d).length;
      if (n >= 2 && (!best || n > best.n)) best = { d, n };
    }
    if (best) {
      stats.delimited += 1;
      const prev = delimHits.get(best.d) ?? { count: 0, pieces: 0 };
      delimHits.set(best.d, { count: prev.count + 1, pieces: prev.pieces + best.n });
    } else {
      stats.other += 1;
    }
  }
  let top: { d: string; count: number; pieces: number } | null = null;
  for (const [d, v] of delimHits) {
    if (!top || v.count > top.count) top = { d, ...v };
  }
  if (top) {
    stats.delimiterGuess = top.d;
    stats.pieceCountGuess = Math.round(top.pieces / Math.max(1, top.count));
  }
  return stats;
}

export async function profileGlobal(
  driver: YdbDriver,
  name: string,
  opts?: { maxNodes?: number; maxDepth?: number },
): Promise<GlobalProfile> {
  const maxNodes = opts?.maxNodes ?? 800;
  const maxDepth = opts?.maxDepth ?? 8;
  const hits = await driver.walk(name, [], { maxNodes: maxNodes + 1, multilevel: true });
  const truncated = hits.length > maxNodes;
  const nodes = hits.slice(0, maxNodes);
  const levelMap = new Map<number, LevelProfile>();
  const values: string[] = [];
  const samples: NodeHit[] = [];

  for (const hit of nodes) {
    if (hit.key.length > maxDepth) continue;
    if (hit.data !== null) values.push(hit.data);
    if (samples.length < 20 && hit.data !== null) samples.push(hit);
    else if (samples.length < 12) samples.push(hit);

    hit.key.forEach((part, idx) => {
      const depth = idx;
      let level = levelMap.get(depth);
      if (!level) {
        level = {
          depth,
          samples: 0,
          subscriptKinds: {},
          examples: [],
          hasValue: 0,
          hasChildren: 0,
        };
        levelMap.set(depth, level);
      }
      level.samples += 1;
      const kind = classifySubscript(part);
      level.subscriptKinds[kind] = (level.subscriptKinds[kind] ?? 0) + 1;
      if (level.examples.length < 8 && !level.examples.map(String).includes(String(part))) {
        level.examples.push(part);
      }
    });
    const leafDepth = hit.key.length - 1;
    const leaf = levelMap.get(leafDepth);
    if (leaf) {
      if (hit.data !== null) leaf.hasValue += 1;
      if (hit.defined >= 10) leaf.hasChildren += 1;
    }
  }

  return {
    name,
    scannedNodes: nodes.length,
    truncated,
    maxDepth: nodes.reduce((m, n) => Math.max(m, n.key.length), 0),
    levels: [...levelMap.values()].sort((a, b) => a.depth - b.depth),
    value: guessValue(values),
    sampleNodes: samples,
  };
}
