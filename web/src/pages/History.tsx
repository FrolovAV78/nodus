import { useEffect, useState } from "react";
import { api, type HistoryItem } from "../lib/api";
import { Card, PageTitle } from "../components/Layout";

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  useEffect(() => {
    api.history().then((r) => setItems(r.items));
  }, []);
  return (
    <div>
      <PageTitle kicker="Аудит" title="История запросов" hint="Кто что спрашивал и чем закончилось." />
      <div className="grid gap-3">
        {items.map((it) => (
          <Card key={it.id}>
            <div className="flex justify-between gap-4 text-sm">
              <div>
                <div className="font-medium">
                  {it.source}
                  {it.prompt ? ` · ${it.prompt}` : ""}
                </div>
                <div className="text-xs text-[#8b97ad]">
                  {it.user} · {new Date(it.at).toLocaleString("ru")}
                  {it.plan ? ` · ^${it.plan.global}` : ""}
                </div>
              </div>
              <div className={it.ok ? "text-[#6ee7c5]" : "text-rose-300"}>
                {it.ok ? `${it.rows ?? 0} строк` : it.error}
              </div>
            </div>
          </Card>
        ))}
        {!items.length ? <div className="text-sm text-[#8b97ad]">Пока пусто.</div> : null}
      </div>
    </div>
  );
}
