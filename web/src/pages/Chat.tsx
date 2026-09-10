import { useState } from "react";
import { api, type QueryPlan, type QueryResult } from "../lib/api";
import { Btn, Card, PageTitle } from "../components/Layout";
import ResultTable from "../components/ResultTable";

type Msg = { role: "user" | "sys"; text: string; plan?: QueryPlan; result?: QueryResult };

export default function Chat() {
  const [text, setText] = useState("Продажи по регионам за 2025 год");
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "sys",
      text: "Спросите по-русски. Пока нет живой базы — отвечает демо-контур. После описания схемы модель будет целиться точнее.",
    },
  ]);
  const [busy, setBusy] = useState(false);

  async function send() {
    const q = text.trim();
    if (!q) return;
    setText("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const r = await api.chat(q);
      setMsgs((m) => [
        ...m,
        {
          role: "sys",
          text: r.plan.explanation || `План по ^${r.plan.global}`,
          plan: r.plan,
          result: r.result,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "sys", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <PageTitle
        kicker="Естественный язык"
        title="Чат-запросы"
        hint="Фраза → план обхода global → таблица. Ключ OpenAI-compatible задаётся в Настройках."
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
        {msgs.map((m, i) => (
          <Card key={i} className={m.role === "user" ? "ml-16 bg-[#6ee7c5]/10" : "mr-8"}>
            <div className="text-sm whitespace-pre-wrap">{m.text}</div>
            {m.plan ? (
              <pre className="mt-3 overflow-auto rounded-xl bg-[#0b1020] p-3 font-mono text-xs text-[#9cb0d0]">
                {JSON.stringify(m.plan, null, 2)}
              </pre>
            ) : null}
            {m.result ? (
              <div className="mt-4">
                <ResultTable result={m.result} title={m.plan?.global || "chat"} />
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: сумма продаж по месяцам 2025"
          className="flex-1 rounded-2xl border border-white/10 bg-[#121a31] px-4 py-3"
        />
        <Btn type="submit" disabled={busy}>
          {busy ? "Считаю…" : "Спросить"}
        </Btn>
      </form>
    </div>
  );
}
