import { getState } from "./store.ts";
import type { QueryPlan } from "./ydb/types.ts";

const SYSTEM = `Ты аналитический планировщик запросов к иерархической БД YottaDB.
Тебе дают каталог globals: имя, уровни субскриптов, куски значения (piece) и образцы.
Пользователь пишет вопрос на русском. Верни ТОЛЬКО JSON объекта QueryPlan:
{
  "global": "NAME_WITHOUT_CARET",
  "filters": [{"depth": 0, "op": "eq|neq|contains|prefix|gt|lt|gte|lte", "value": "…"}],
  "groupBy": [0, 2],
  "metric": {"fn": "count|sum|avg|min|max", "piece": 0, "delimiter": "|"},
  "limit": 100,
  "explanation": "коротко по-русски, что будет посчитано"
}
Правила:
- Имена globals без ^.
- depth — индекс субскрипта с нуля.
- Для сумм/средних бери числовой piece.
- Не выдумывай globals, которых нет в каталоге.
- Если вопрос нельзя закрыть каталогом, верни {"error": "…", "suggestion": "…"}.`;

export async function planFromPrompt(prompt: string): Promise<{
  plan?: QueryPlan & { explanation?: string };
  error?: string;
  raw?: string;
}> {
  const { llm, schema, profiles } = getState();
  if (!llm.apiKey) {
    return ruleFallback(prompt);
  }
  const catalog = {
    notes: schema,
    profiles: profiles.map((p) => ({
      name: p.name,
      levels: p.levels.map((l) => ({
        depth: l.depth,
        kinds: l.subscriptKinds,
        examples: l.examples,
      })),
      value: {
        delimiterGuess: p.value.delimiterGuess,
        pieceCountGuess: p.value.pieceCountGuess,
        samples: p.value.samples.slice(0, 6),
      },
    })),
  };
  const url = llm.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llm.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `КАТАЛОГ:\n${JSON.stringify(catalog)}\n\nВОПРОС:\n${prompt}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `LLM HTTP ${res.status}: ${text.slice(0, 400)}` };
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as QueryPlan & { error?: string; explanation?: string };
    if (parsed.error) return { error: parsed.error, raw: content };
    if (!parsed.global) return { error: "Модель не указала global", raw: content };
    return { plan: parsed, raw: content };
  } catch {
    return { error: "Модель вернула не JSON", raw: content };
  }
}

function ruleFallback(prompt: string): {
  plan?: QueryPlan & { explanation?: string };
  error?: string;
} {
  const q = prompt.toLowerCase();
  if (q.includes("продаж") || q.includes("регион")) {
    return {
      plan: {
        global: "SALES",
        groupBy: q.includes("месяц") ? [0, 1] : [2],
        metric: { fn: "sum", piece: 0, delimiter: "|" },
        limit: 50,
        explanation:
          "Ключ LLM не задан — эвристика: сумма продаж из ^SALES. Добавьте ключ в Настройках.",
      },
    };
  }
  if (q.includes("клиент") || q.includes("контрагент")) {
    return {
      plan: {
        global: "CUSTOMER",
        limit: 200,
        explanation: "Список клиентов из ^CUSTOMER (режим без LLM).",
      },
    };
  }
  if (q.includes("заказ")) {
    const filters = [];
    const year = q.match(/20\d{2}/)?.[0];
    if (year) filters.push({ depth: 0, op: "eq" as const, value: year });
    return {
      plan: {
        global: "ORDER",
        filters,
        limit: 200,
        explanation: "Заказы из ^ORDER (режим без LLM).",
      },
    };
  }
  return {
    error:
      "Нет ключа LLM и не удалось разобрать фразу эвристикой. Укажите OpenAI-compatible ключ в Настройках или уточните global.",
  };
}
