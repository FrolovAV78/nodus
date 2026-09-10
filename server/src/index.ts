import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import ExcelJS from "exceljs";
import {
  getState,
  hashPassword,
  publicUser,
  readToken,
  signToken,
  updateState,
  verifyPassword,
  type Role,
} from "./store.ts";
import { MockDriver } from "./ydb/mock.ts";
import { TcpDriver } from "./ydb/tcp.ts";
import { profileGlobal } from "./ydb/profiler.ts";
import { runPlan } from "./ydb/query.ts";
import { planFromPrompt } from "./llm.ts";
import type { QueryPlan, YdbDriver } from "./ydb/types.ts";

const mock = new MockDriver();
const tcp = new TcpDriver();
await mock.connect(getState().connection);

function driver(): YdbDriver {
  return getState().activeMode === "tcp" && tcp.connected ? tcp : mock;
}

const app = new Hono();
app.use(
  "*",
  cors({
    origin: (origin) => origin || "http://localhost:5173",
    credentials: true,
  }),
);

app.use("*", async (c, next) => {
  const token = getCookie(c, "nodus") || c.req.header("authorization")?.replace("Bearer ", "");
  const session = token ? readToken(token) : null;
  c.set("session" as never, session as never);
  await next();
});

function session(c: { get: (k: never) => unknown }) {
  return c.get("session" as never) as { uid: string; role: Role; username: string } | null;
}

function needAuth(c: Parameters<typeof session>[0]) {
  const s = session(c);
  if (!s) return null;
  return s;
}

const api = new Hono();

api.post("/auth/login", async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const user = getState().users.find((u) => u.username === body.username);
  if (!user || !verifyPassword(body.password, user.password)) {
    return c.json({ error: "Неверный логин или пароль" }, 401);
  }
  const token = signToken({ uid: user.id, role: user.role, username: user.username });
  const proto = c.req.header("x-forwarded-proto") || new URL(c.req.url).protocol.replace(":", "");
  setCookie(c, "nodus", token, {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: proto === "https",
    maxAge: 7 * 86400,
  });
  return c.json({ user: publicUser(user) });
});

api.post("/auth/logout", (c) => {
  deleteCookie(c, "nodus", { path: "/" });
  return c.json({ ok: true });
});

api.get("/auth/me", (c) => {
  const s = needAuth(c);
  if (!s) return c.json({ user: null });
  const user = getState().users.find((u) => u.id === s.uid);
  return c.json({ user: user ? publicUser(user) : null });
});

api.get("/status", (c) => {
  const s = getState();
  const d = driver();
  return c.json({
    mode: s.activeMode,
    driver: { mode: d.mode, connected: d.connected, label: d.label },
    tcpConnected: tcp.connected,
    llmReady: Boolean(s.llm.apiKey),
    llmModel: s.llm.model,
    connection: { host: s.connection.host, port: s.connection.port },
  });
});

api.get("/config", (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  const s = getState();
  return c.json({
    connection: s.connection,
    llm: { baseUrl: s.llm.baseUrl, model: s.llm.model, apiKeySet: Boolean(s.llm.apiKey) },
    activeMode: s.activeMode,
  });
});

api.put("/config", async (c) => {
  const s = needAuth(c);
  if (!s || s.role === "viewer") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{
    connection?: typeof getState extends () => infer S ? S["connection"] : never;
    llm?: { baseUrl?: string; model?: string; apiKey?: string };
    activeMode?: "mock" | "tcp";
  }>();
  const cur = getState();
  updateState({
    connection: body.connection ? { ...cur.connection, ...body.connection } : cur.connection,
    llm: body.llm
      ? {
          ...cur.llm,
          ...body.llm,
          apiKey: body.llm.apiKey === "" || body.llm.apiKey ? body.llm.apiKey : cur.llm.apiKey,
        }
      : cur.llm,
    activeMode: body.activeMode ?? cur.activeMode,
  });
  return c.json({ ok: true });
});

api.post("/ydb/connect", async (c) => {
  const s = needAuth(c);
  if (!s || s.role === "viewer") return c.json({ error: "forbidden" }, 403);
  const cfg = getState().connection;
  try {
    await tcp.disconnect();
    await tcp.connect(cfg);
    updateState({ activeMode: "tcp" });
    return c.json({ ok: true, label: tcp.label });
  } catch (err) {
    updateState({ activeMode: "mock" });
    return c.json({ error: String(err) }, 502);
  }
});

api.post("/ydb/disconnect", async (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  await tcp.disconnect();
  updateState({ activeMode: "mock" });
  return c.json({ ok: true, mode: "mock" });
});

api.get("/ydb/globals", async (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  const names = await driver().listGlobals();
  return c.json({ globals: names, source: driver().label });
});

api.post("/ydb/profile", async (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  const body = await c.req.json<{ globals: string[]; maxNodes?: number }>();
  const selected = body.globals?.length ? body.globals : await driver().listGlobals();
  const profiles = [];
  for (const name of selected.slice(0, 40)) {
    profiles.push(await profileGlobal(driver(), name, { maxNodes: body.maxNodes ?? 800 }));
  }
  const prev = getState().profiles.filter((p) => !profiles.some((n) => n.name === p.name));
  updateState({ profiles: [...prev, ...profiles] });
  return c.json({ profiles, source: driver().label });
});

api.get("/ydb/browse", async (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  const global = c.req.query("global") || "";
  const seed = (c.req.query("seed") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
  const nodes = await driver().walk(global, seed, { maxNodes: 200, multilevel: false });
  return c.json({ nodes });
});

api.post("/ydb/query", async (c) => {
  const s = needAuth(c);
  if (!s) return c.json({ error: "auth" }, 401);
  const plan = await c.req.json<QueryPlan>();
  try {
    const result = await runPlan(driver(), plan);
    const history = [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        user: s.username,
        source: "query" as const,
        plan,
        ok: true,
        rows: result.rows.length,
      },
      ...getState().history,
    ].slice(0, 200);
    updateState({ history });
    return c.json({ result, plan });
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
});

api.post("/chat", async (c) => {
  const s = needAuth(c);
  if (!s) return c.json({ error: "auth" }, 401);
  const body = await c.req.json<{ message: string }>();
  const planned = await planFromPrompt(body.message);
  if (!planned.plan) {
    const history = [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        user: s.username,
        source: "chat" as const,
        prompt: body.message,
        ok: false,
        error: planned.error,
      },
      ...getState().history,
    ].slice(0, 200);
    updateState({ history });
    return c.json({ error: planned.error, raw: planned.raw }, 422);
  }
  const result = await runPlan(driver(), planned.plan);
  const history = [
    {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      user: s.username,
      source: "chat" as const,
      prompt: body.message,
      plan: planned.plan,
      ok: true,
      rows: result.rows.length,
    },
    ...getState().history,
  ].slice(0, 200);
  updateState({ history });
  return c.json({ plan: planned.plan, result });
});

api.get("/schema", (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  return c.json({ notes: getState().schema, profiles: getState().profiles });
});

api.put("/schema", async (c) => {
  const s = needAuth(c);
  if (!s || s.role === "viewer") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ notes: typeof getState extends () => infer S ? S["schema"] : never }>();
  updateState({ schema: body.notes });
  return c.json({ ok: true });
});

api.get("/history", (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  return c.json({ items: getState().history });
});

api.get("/reports", (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  return c.json({ items: getState().reports });
});

api.post("/reports", async (c) => {
  const s = needAuth(c);
  if (!s || s.role === "viewer") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{
    title: string;
    description?: string;
    plan: QueryPlan;
    chart?: "bar" | "line" | "pie" | "table";
  }>();
  const item = {
    id: crypto.randomUUID(),
    title: body.title,
    description: body.description || "",
    plan: body.plan,
    chart: body.chart || "bar",
    owner: s.username,
    createdAt: new Date().toISOString(),
  };
  updateState({ reports: [item, ...getState().reports] });
  return c.json({ item });
});

api.delete("/reports/:id", (c) => {
  const s = needAuth(c);
  if (!s || s.role === "viewer") return c.json({ error: "forbidden" }, 403);
  updateState({ reports: getState().reports.filter((r) => r.id !== c.req.param("id")) });
  return c.json({ ok: true });
});

api.get("/users", (c) => {
  const s = needAuth(c);
  if (!s || s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  return c.json({ users: getState().users.map(publicUser) });
});

api.post("/users", async (c) => {
  const s = needAuth(c);
  if (!s || s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ username: string; name: string; role: Role; password: string }>();
  if (getState().users.some((u) => u.username === body.username)) {
    return c.json({ error: "Такой пользователь уже есть" }, 409);
  }
  const user = {
    id: crypto.randomUUID(),
    username: body.username,
    name: body.name,
    role: body.role,
    password: hashPassword(body.password),
  };
  updateState({ users: [...getState().users, user] });
  return c.json({ user: publicUser(user) });
});

api.post("/export/xlsx", async (c) => {
  if (!needAuth(c)) return c.json({ error: "auth" }, 401);
  const body = await c.req.json<{ columns: string[]; rows: Array<Array<string | number | null>>; title?: string }>();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(body.title || "result");
  ws.addRow(body.columns);
  body.rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(body.title || "nodus")}.xlsx"`,
    },
  });
});

app.route("/api", api);

app.get("/health", (c) => c.json({ ok: true }));

const webDist = process.env.WEB_DIST || join(process.cwd(), "..", "web", "dist");
if (existsSync(join(webDist, "index.html"))) {
  const indexHtml = readFileSync(join(webDist, "index.html"), "utf8");
  app.use("/assets/*", serveStatic({ root: webDist }));
  app.get("/*", (c) => c.html(indexHtml));
} else {
  app.get("/", (c) =>
    c.text(
      "UI не собран. Из папки nodus выполните: npm install && npm run build && npm start\nЗатем откройте http://localhost:8787",
    ),
  );
}

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  console.log(`Nodus http://localhost:${port}`);
});
