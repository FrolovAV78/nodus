import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type QueryResult } from "../lib/api";
import { Card, PageTitle } from "../components/Layout";

export default function Dashboard() {
  const [sales, setSales] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .query({
        global: "SALES",
        filters: [{ depth: 0, op: "eq", value: "2025" }],
        groupBy: [2],
        metric: { fn: "sum", piece: 0, delimiter: "|" },
      })
      .then((r) => setSales(r.result))
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const chart =
    sales?.rows.map((row) => ({
      name: String(row[0]),
      value: Number(row[1] ?? 0),
    })) ?? [];

  return (
    <div>
      <PageTitle
        kicker="Обзор"
        title="Дашборд"
        hint="Стартовые KPI по демо ^SALES. После подключения живой базы и описания схемы карточки завяжем на сохранённые отчёты."
      />
      {error ? <div className="text-sm text-rose-300">{error}</div> : null}
      <div className="grid gap-5 lg:grid-cols-3">
        {chart.slice(0, 3).map((c) => (
          <Card key={c.name}>
            <div className="text-xs text-[#8b97ad]">{c.name}</div>
            <div className="mt-2 text-2xl font-semibold">
              {c.value.toLocaleString("ru-RU")}
            </div>
            <div className="text-xs text-[#8b97ad]">сумма piece 0 · 2025</div>
          </Card>
        ))}
      </div>
      <Card className="mt-5 h-96">
        <div className="mb-3 text-sm text-[#8b97ad]">Продажи по регионам, 2025</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={chart}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="name" stroke="#8b97ad" fontSize={12} />
            <YAxis stroke="#8b97ad" fontSize={12} />
            <Tooltip
              contentStyle={{ background: "#121a31", border: "1px solid rgba(255,255,255,0.1)" }}
            />
            <Bar dataKey="value" fill="#6ee7c5" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
