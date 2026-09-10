import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConnectionConfig, GlobalProfile, QueryPlan } from "./ydb/types.ts";

export type Role = "admin" | "analyst" | "viewer";

export type User = {
  id: string;
  username: string;
  name: string;
  role: Role;
  password: string;
};

export type SavedReport = {
  id: string;
  title: string;
  description: string;
  plan: QueryPlan;
  chart: "bar" | "line" | "pie" | "table";
  owner: string;
  createdAt: string;
};

export type HistoryItem = {
  id: string;
  at: string;
  user: string;
  source: "chat" | "explorer" | "query" | "dashboard";
  prompt?: string;
  plan?: QueryPlan;
  ok: boolean;
  error?: string;
  rows?: number;
};

export type SchemaNote = {
  global: string;
  title?: string;
  description?: string;
  levels?: Array<{ depth: number; name: string; meaning?: string }>;
  pieces?: Array<{ index: number; name: string; meaning?: string }>;
  delimiter?: string;
};

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AppState = {
  users: User[];
  reports: SavedReport[];
  history: HistoryItem[];
  schema: SchemaNote[];
  profiles: GlobalProfile[];
  connection: ConnectionConfig;
  llm: LlmConfig;
  activeMode: "mock" | "tcp";
};

const dataDir = process.env.DATA_DIR || join(process.cwd(), "..", "data");
const file = join(dataDir, "state.json");
const secret = process.env.APP_SECRET || "nodus-dev-secret";

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 32).toString("hex");
  return `${s}:${hash}`;
}

export function verifyPassword(password: string, packed: string): boolean {
  const [salt, hash] = packed.split(":");
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 32);
  const left = Buffer.from(hash, "hex");
  if (left.length !== check.length) return false;
  return timingSafeEqual(left, check);
}

function seed(): AppState {
  return {
    users: [
      {
        id: "u-admin",
        username: "admin",
        name: "Администратор",
        role: "admin",
        password: hashPassword("changeme"),
      },
      {
        id: "u-analyst",
        username: "analyst",
        name: "Аналитик",
        role: "analyst",
        password: hashPassword("analyst"),
      },
    ],
    reports: [],
    history: [],
    schema: [
      {
        global: "CUSTOMER",
        title: "Клиенты",
        description: "Карточка контрагента",
        levels: [{ depth: 0, name: "customer_id", meaning: "Код клиента" }],
        delimiter: "|",
        pieces: [
          { index: 0, name: "name", meaning: "Название" },
          { index: 1, name: "city", meaning: "Город" },
          { index: 2, name: "region", meaning: "Регион" },
          { index: 3, name: "segment", meaning: "Сегмент" },
          { index: 4, name: "employees", meaning: "Сотрудники" },
        ],
      },
      {
        global: "ORDER",
        title: "Заказы",
        description: "Шапка заказа и строки LINE",
        levels: [
          { depth: 0, name: "year", meaning: "Год" },
          { depth: 1, name: "month", meaning: "Месяц" },
          { depth: 2, name: "order_id", meaning: "Номер заказа" },
          { depth: 3, name: "kind", meaning: "LINE — позиции" },
          { depth: 4, name: "line_no", meaning: "Номер строки" },
        ],
        delimiter: "|",
        pieces: [
          { index: 0, name: "customer_or_sku", meaning: "Клиент (шапка) или SKU (строка)" },
          { index: 1, name: "status_or_qty", meaning: "Статус или количество" },
          { index: 2, name: "amount_or_price", meaning: "Сумма шапки или цена" },
          { index: 3, name: "date", meaning: "Дата (только шапка)" },
        ],
      },
      {
        global: "SALES",
        title: "Продажи",
        description: "Агрегат по региону и месяцу",
        levels: [
          { depth: 0, name: "year", meaning: "Год" },
          { depth: 1, name: "month", meaning: "Месяц" },
          { depth: 2, name: "region", meaning: "Регион" },
        ],
        delimiter: "|",
        pieces: [
          { index: 0, name: "amount", meaning: "Сумма ₽" },
          { index: 1, name: "orders", meaning: "Число заказов" },
        ],
      },
    ],
    profiles: [],
    connection: {
      host: process.env.YDB_HOST || "127.0.0.1",
      port: Number(process.env.YDB_PORT || 7041),
      timeoutSec: Number(process.env.YDB_TIMEOUT || 10),
      use: "tcp",
    },
    llm: {
      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.LLM_API_KEY || "",
      model: process.env.LLM_MODEL || "gpt-4o-mini",
    },
    activeMode: "mock",
  };
}

function load(): AppState {
  if (!existsSync(file)) return seed();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as AppState;
    const base = seed();
    return { ...base, ...parsed, users: parsed.users?.length ? parsed.users : base.users };
  } catch {
    return seed();
  }
}

let state = load();

export function save() {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function getState(): AppState {
  return state;
}

export function updateState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  save();
}

export function signToken(payload: object): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 86400000 })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readToken(token: string): { uid: string; role: Role; username: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret).update(body).digest("base64url");
  if (expect.length !== sig.length) return null;
  if (!timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      uid: string;
      role: Role;
      username: string;
      exp: number;
    };
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function publicUser(u: User) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

export { hashPassword };
