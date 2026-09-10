# Nodus — аналитика YottaDB

Веб-кабинет для иерархической БД YottaDB: explorer globals, профиль схемы, чат на русском, таблицы, CSV/Excel, дашборд, сохранённые отчёты, история и роли.

Стек: Node.js, Hono, React 19, Vite, Tailwind 4, Recharts. Доступ к базе — `mg-dbx-napi` по TCP (MGateway mgsi). Пока нет живой YottaDB, работает демо-контур (`^CUSTOMER`, `^ORDER`, `^SALES`, `^INVENTORY`).

## Запуск

Нужны [Node.js 20+](https://nodejs.org) и npm.

```bash
npm install
npm run build -w web
npm start -w server
```

Или одним скриптом:

- Windows: `start.cmd`
- macOS / Linux: `bash start.sh`

Откройте **http://localhost:8787**  
Вход: `admin` / `changeme` (второй пользователь: `analyst` / `analyst`)

Режим разработки (два процесса): `npm run dev` — UI на `:5173`, API на `:8787`.

## Живая YottaDB

На стороне БД должен слушать superserver MGateway:

```
do start^%zmgsi(0)    ; порт 7041
```

В UI: Настройки → хост/порт → подключить → Explorer → профилировать выбранные globals.

Чат на естественном языке использует OpenAI-compatible API (ключ в Настройках).

## Публичный доступ (ngrok)

```bash
export NGROK_AUTHTOKEN=ваш_токен
bash start.sh
bash start-ngrok.sh
```

## Структура

```
server/   API (Hono) + драйвер YottaDB
web/      React UI
data/     локальное состояние (не в git)
```
