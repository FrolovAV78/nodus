import type { QueryPlan, QueryResult, YdbDriver } from "./types.ts";

function piece(value: string | null, delim: string, idx: number): string | null {
  if (value === null) return null;
  const parts = value.split(delim);
  return parts[idx] ?? null;
}

function num(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function match(actual: string, op: QueryPlan["filters"] extends infer F
  ? F extends Array<infer I>
    ? I extends { op: infer O }
      ? O
      : never
    : never
  : never, expected: string): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return actual.toLowerCase().includes(expected.toLowerCase());
    case "prefix":
      return actual.startsWith(expected);
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    default:
      return true;
  }
}

export async function runPlan(driver: YdbDriver, plan: QueryPlan): Promise<QueryResult> {
  const limit = plan.limit ?? 500;
  const nodes = await driver.walk(plan.global, [], { maxNodes: 5000, multilevel: true });
  const delim = plan.metric?.delimiter ?? "|";
  const filtered = nodes.filter((hit) => {
    if (!plan.filters?.length) return hit.data !== null || (plan.groupBy && plan.groupBy.length);
    return plan.filters.every((f) => {
      const actual = String(hit.key[f.depth] ?? "");
      return match(actual, f.op, f.value);
    });
  });

  if (plan.groupBy && plan.groupBy.length) {
    const groups = new Map<string, { keys: Array<string | number>; values: number[]; count: number }>();
    for (const hit of filtered) {
      const keys = plan.groupBy.map((d) => hit.key[d] ?? "");
      const id = keys.map(String).join("\u0001");
      let g = groups.get(id);
      if (!g) {
        g = { keys, values: [], count: 0 };
        groups.set(id, g);
      }
      g.count += 1;
      if (plan.metric && plan.metric.fn !== "count") {
        const raw =
          plan.metric.piece === undefined ? hit.data : piece(hit.data, delim, plan.metric.piece);
        const n = num(raw);
        if (n !== null) g.values.push(n);
      }
    }
    const fn = plan.metric?.fn ?? "count";
    const columns = [
      ...plan.groupBy.map((d) => `уровень_${d}`),
      fn === "count" ? "count" : fn,
    ];
    const rows: QueryResult["rows"] = [];
    for (const g of groups.values()) {
      let metric: number | null = g.count;
      if (fn === "sum") metric = g.values.reduce((a, b) => a + b, 0);
      if (fn === "avg")
        metric = g.values.length ? g.values.reduce((a, b) => a + b, 0) / g.values.length : null;
      if (fn === "min") metric = g.values.length ? Math.min(...g.values) : null;
      if (fn === "max") metric = g.values.length ? Math.max(...g.values) : null;
      rows.push([...g.keys, metric]);
      if (rows.length >= limit) break;
    }
    return { columns, rows, scanned: nodes.length, truncated: nodes.length >= 5000 };
  }

  const columns = ["path", "value"];
  const rows = filtered.slice(0, limit).map((hit) => [
    hit.key.join(","),
    hit.data,
  ]);
  return {
    columns,
    rows,
    scanned: nodes.length,
    truncated: nodes.length >= 5000 || filtered.length > limit,
  };
}
