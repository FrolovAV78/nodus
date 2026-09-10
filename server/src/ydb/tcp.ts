import type { ConnectionConfig, NodeHit, YdbDriver } from "./types.ts";

type MgModule = {
  server: new () => {
    open: (cfg: Record<string, unknown>) => unknown;
    close: () => unknown;
  };
  mcursor: new (
    db: unknown,
    q: Record<string, unknown>,
    opt?: Record<string, unknown>,
  ) => { next: () => unknown };
  mglobal: new (
    db: unknown,
    name: string,
  ) => {
    get: (...key: unknown[]) => unknown;
    next: (...key: unknown[]) => unknown;
  };
};

export class TcpDriver implements YdbDriver {
  mode = "tcp" as const;
  connected = false;
  label = "YottaDB TCP";
  private db: InstanceType<MgModule["server"]> | null = null;
  private mg: MgModule | null = null;

  private async load(): Promise<MgModule> {
    if (this.mg) return this.mg;
    try {
      this.mg = (await import("mg-dbx-napi")) as unknown as MgModule;
      return this.mg;
    } catch (err) {
      throw new Error(
        `Не удалось загрузить mg-dbx-napi: ${String(err)}. Установите пакет и пересоберите native addon.`,
      );
    }
  }

  async connect(cfg: ConnectionConfig): Promise<void> {
    const mg = await this.load();
    const db = new mg.server();
    const openCfg: Record<string, unknown> = {
      type: "YottaDB",
      use: "tcp",
      host: cfg.host,
      tcp_port: cfg.port,
      timeout: cfg.timeoutSec,
    };
    if (cfg.path) openCfg.path = cfg.path;
    if (cfg.envVars) openCfg.env_vars = cfg.envVars;
    const result = db.open(openCfg);
    if (result && typeof result === "object" && "error" in (result as object)) {
      throw new Error(String((result as { error: unknown }).error));
    }
    this.db = db;
    this.connected = true;
    this.label = `${cfg.host}:${cfg.port}`;
  }

  async disconnect(): Promise<void> {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
    this.connected = false;
  }

  async listGlobals(): Promise<string[]> {
    const mg = await this.load();
    if (!this.db) throw new Error("Нет соединения");
    const query = new mg.mcursor(this.db, { global: "" }, { globaldirectory: true });
    const names: string[] = [];
    for (;;) {
      const next = query.next();
      if (next === null || next === undefined || next === "") break;
      if (typeof next === "object" && next && "error" in next) {
        throw new Error(String((next as { error: unknown }).error));
      }
      const name =
        typeof next === "string"
          ? next.replace(/^\^/, "")
          : String((next as { global?: string }).global ?? next).replace(/^\^/, "");
      if (name) names.push(name);
      if (names.length > 5000) break;
    }
    return names.sort();
  }

  async get(global: string, key: Array<string | number>): Promise<string | null> {
    const mg = await this.load();
    if (!this.db) throw new Error("Нет соединения");
    const g = new mg.mglobal(this.db, global);
    const value = key.length ? g.get(...key) : g.get();
    if (value === null || value === undefined || value === "") return null;
    return String(value);
  }

  async nextSubscript(
    global: string,
    key: Array<string | number>,
  ): Promise<string | number | null> {
    const mg = await this.load();
    if (!this.db) throw new Error("Нет соединения");
    const g = new mg.mglobal(this.db, global);
    const value = key.length ? g.next(...key) : g.next("");
    if (value === null || value === undefined || value === "") return null;
    return coerce(value);
  }

  async walk(
    global: string,
    seed: Array<string | number>,
    opts: { maxNodes: number; multilevel: boolean },
  ): Promise<NodeHit[]> {
    const mg = await this.load();
    if (!this.db) throw new Error("Нет соединения");
    const query = new mg.mcursor(
      this.db,
      { global, key: seed.length ? seed : [""] },
      { multilevel: opts.multilevel, getdata: true },
    );
    const out: NodeHit[] = [];
    for (;;) {
      const next = query.next();
      if (next === null || next === undefined) break;
      if (typeof next === "object" && next && "error" in next) {
        throw new Error(String((next as { error: unknown }).error));
      }
      if (typeof next === "object" && next) {
        const rec = next as { key?: unknown; data?: unknown; global?: unknown };
        const key = Array.isArray(rec.key)
          ? rec.key.map(coerce)
          : seed.length
            ? [...seed, coerce(next)]
            : [coerce(next)];
        out.push({
          key,
          data: rec.data === undefined || rec.data === null ? null : String(rec.data),
          defined: rec.data === undefined || rec.data === null ? 10 : 11,
        });
      } else {
        out.push({ key: [...seed, coerce(next)], data: null, defined: 10 });
      }
      if (out.length >= opts.maxNodes) break;
    }
    return out;
  }
}

function coerce(value: unknown): string | number {
  if (typeof value === "number") return value;
  const s = String(value);
  if (s !== "" && Number.isFinite(Number(s)) && String(Number(s)) === s) return Number(s);
  return s;
}
