#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "Нужны Node.js 20+ и npm. Поставьте с https://nodejs.org и запустите скрипт снова."
  exit 1
fi

echo "→ npm install"
npm install

echo "→ сборка интерфейса"
npm run build -w web

export PORT="${PORT:-8787}"
export DATA_DIR="${DATA_DIR:-$PWD/data}"
export WEB_DIST="$PWD/web/dist"
mkdir -p "$DATA_DIR"

echo
echo "Откройте в браузере:  http://localhost:${PORT}"
echo "Логин: admin    пароль: changeme"
echo

npm run start -w server
