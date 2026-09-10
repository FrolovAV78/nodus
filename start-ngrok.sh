#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${NGROK_AUTHTOKEN:-}" ]; then
  echo "Нужен токен ngrok."
  echo "1) Зарегистрируйтесь: https://dashboard.ngrok.com/signup"
  echo "2) Скопируйте токен: https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "3) Запустите:"
  echo "   export NGROK_AUTHTOKEN=ваш_токен"
  echo "   bash start.sh          # в одном окне"
  echo "   bash start-ngrok.sh    # в другом"
  exit 1
fi

if ! command -v ngrok >/dev/null 2>&1; then
  echo "Скачайте ngrok: https://ngrok.com/download"
  echo "или: npm i -g ngrok"
  exit 1
fi

ngrok config add-authtoken "$NGROK_AUTHTOKEN"
echo "Туннель на http://127.0.0.1:8787 — публичный URL будет в этом окне и на http://127.0.0.1:4040"
exec ngrok http 8787
