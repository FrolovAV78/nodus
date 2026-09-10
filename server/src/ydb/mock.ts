import type { ConnectionConfig, NodeHit, YdbDriver } from "./types.ts";

type Leaf = { data: string | null; children: Map<string, Leaf> };

function kindKey(v: string | number): string {
  return String(v);
}

function cmp(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  const aNum = a !== "" && Number.isFinite(an) && String(an) === a;
  const bNum = b !== "" && Number.isFinite(bn) && String(bn) === b;
  if (aNum && bNum) return an - bn;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function put(root: Leaf, key: Array<string | number>, data: string | null) {
  let node = root;
  for (const part of key) {
    const k = kindKey(part);
    let child = node.children.get(k);
    if (!child) {
      child = { data: null, children: new Map() };
      node.children.set(k, child);
    }
    node = child;
  }
  node.data = data;
}

function getNode(root: Leaf, key: Array<string | number>): Leaf | null {
  let node = root;
  for (const part of key) {
    const child = node.children.get(kindKey(part));
    if (!child) return null;
    node = child;
  }
  return node;
}

function sortedKeys(node: Leaf): string[] {
  return [...node.children.keys()].sort(cmp);
}

export class MockDriver implements YdbDriver {
  mode = "mock" as const;
  connected = false;
  label = "Демо-контур";
  private globals = new Map<string, Leaf>();

  constructor() {
    this.seed();
  }

  async connect(_cfg: ConnectionConfig): Promise<void> {
    this.connected = true;
    this.label = "Демо-контур";
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async listGlobals(): Promise<string[]> {
    return [...this.globals.keys()].sort(cmp);
  }

  async get(global: string, key: Array<string | number>): Promise<string | null> {
    const g = this.globals.get(global);
    if (!g) return null;
    return getNode(g, key)?.data ?? null;
  }

  async nextSubscript(
    global: string,
    key: Array<string | number>,
  ): Promise<string | number | null> {
    const g = this.globals.get(global);
    if (!g) return null;
    if (key.length === 0) {
      const keys = sortedKeys(g);
      return keys[0] ?? null;
    }
    const parentKey = key.slice(0, -1);
    const last = kindKey(key[key.length - 1]);
    const parent = getNode(g, parentKey);
    if (!parent) return null;
    const keys = sortedKeys(parent);
    const idx = keys.findIndex((k) => k === last);
    if (idx < 0) {
      const next = keys.find((k) => cmp(k, last) > 0);
      return next ?? null;
    }
    return keys[idx + 1] ?? null;
  }

  async walk(
    global: string,
    seed: Array<string | number>,
    opts: { maxNodes: number; multilevel: boolean },
  ): Promise<NodeHit[]> {
    const g = this.globals.get(global);
    if (!g) return [];
    const out: NodeHit[] = [];
    const visit = (node: Leaf, key: Array<string | number>, onlyDirect: boolean) => {
      if (out.length >= opts.maxNodes) return;
      if (key.length > seed.length || node.data !== null || node.children.size) {
        if (key.length > 0 && key.length >= seed.length) {
          out.push({
            key: [...key],
            data: node.data,
            defined: (node.data !== null ? 1 : 0) + (node.children.size ? 10 : 0),
          });
        }
      }
      if (onlyDirect && key.length > seed.length) return;
      for (const k of sortedKeys(node)) {
        if (out.length >= opts.maxNodes) return;
        visit(node.children.get(k)!, [...key, looksNumber(k) ? Number(k) : k], onlyDirect);
      }
    };
    const start = getNode(g, seed) ?? g;
    visit(start, [...seed], !opts.multilevel);
    return out;
  }

  private seed() {
    const add = (name: string, key: Array<string | number>, data: string) => {
      let g = this.globals.get(name);
      if (!g) {
        g = { data: null, children: new Map() };
        this.globals.set(name, g);
      }
      put(g, key, data);
    };

    add("CUSTOMER", ["C001"], "Северсталь|Череповец|Северо-Запад|enterprise|4800");
    add("CUSTOMER", ["C002"], "Магнит|Краснодар|Юг|retail|12500");
    add("CUSTOMER", ["C003"], "X5 Group|Москва|Центр|retail|9800");
    add("CUSTOMER", ["C004"], "Норникель|Норильск|Сибирь|enterprise|2100");
    add("CUSTOMER", ["C005"], "Газпром нефть|Санкт-Петербург|Северо-Запад|enterprise|3600");
    add("CUSTOMER", ["C006"], "Лента|Новосибирск|Сибирь|retail|5400");
    add("CUSTOMER", ["C007"], "Русал|Красноярск|Сибирь|enterprise|1900");
    add("CUSTOMER", ["C008"], "ВкусВилл|Москва|Центр|retail|2200");

    const orders: Array<[number, number, string, string]> = [
      [2024, 11, "ORD-0881", "C002|paid|428000|2024-11-03"],
      [2024, 12, "ORD-0902", "C001|paid|1960000|2024-12-18"],
      [2024, 12, "ORD-0914", "C004|open|810000|2024-12-27"],
      [2025, 1, "ORD-1001", "C001|paid|1250000|2025-01-14"],
      [2025, 1, "ORD-1002", "C003|paid|336000|2025-01-19"],
      [2025, 1, "ORD-1008", "C005|cancelled|99000|2025-01-22"],
      [2025, 2, "ORD-1044", "C002|paid|512000|2025-02-07"],
      [2025, 2, "ORD-1051", "C006|paid|188000|2025-02-16"],
      [2025, 3, "ORD-1102", "C001|paid|2040000|2025-03-02"],
      [2025, 3, "ORD-1119", "C007|open|670000|2025-03-21"],
      [2025, 4, "ORD-1203", "C008|paid|142000|2025-04-09"],
      [2025, 4, "ORD-1210", "C003|paid|455000|2025-04-18"],
      [2025, 5, "ORD-1301", "C004|paid|1230000|2025-05-05"],
      [2025, 5, "ORD-1317", "C005|paid|880000|2025-05-28"],
      [2025, 6, "ORD-1402", "C006|open|210000|2025-06-11"],
    ];
    for (const [y, m, id, data] of orders) add("ORDER", [y, m, id], data);

    add("ORDER", [2025, 1, "ORD-1001", "LINE", 1], "ST-ARM|12|89000");
    add("ORDER", [2025, 1, "ORD-1001", "LINE", 2], "ST-PLATE|4|48000");
    add("ORDER", [2025, 1, "ORD-1002", "LINE", 1], "RETAIL-PACK|80|4200");
    add("ORDER", [2025, 3, "ORD-1102", "LINE", 1], "ST-ARM|20|89000");
    add("ORDER", [2025, 3, "ORD-1102", "LINE", 2], "ST-PIPE|6|43000");
    add("ORDER", [2025, 5, "ORD-1301", "LINE", 1], "NI-CATHODE|8|145000");

    const regions = ["Северо-Запад", "Центр", "Юг", "Сибирь"];
    for (const year of [2024, 2025]) {
      for (const month of [1, 2, 3, 4, 5, 6, 11, 12]) {
        if (year === 2024 && month < 11) continue;
        if (year === 2025 && month > 6) continue;
        for (const region of regions) {
          const base = region === "Центр" ? 9 : region === "Сибирь" ? 6 : 7;
          const amount = (base * 100000 + month * 17000 + year) * (year === 2025 ? 1.12 : 1);
          const count = base + (month % 3);
          add("SALES", [year, month, region], `${Math.round(amount)}|${count}`);
        }
      }
    }

    add("INVENTORY", ["ST-ARM", "Череповец"], "140|т|склад-А");
    add("INVENTORY", ["ST-ARM", "Москва"], "18|т|склад-Ц");
    add("INVENTORY", ["ST-PLATE", "Череповец"], "55|т|склад-А");
    add("INVENTORY", ["NI-CATHODE", "Норильск"], "9|т|склад-С");
    add("INVENTORY", ["RETAIL-PACK", "Краснодар"], "2400|шт|РЦ-Юг");

    add("TMP", ["job", 4412], "scratch");
    add("%ydboctoX", ["meta"], "system");
  }
}

function looksNumber(s: string): boolean {
  return s !== "" && Number.isFinite(Number(s)) && String(Number(s)) === s;
}
