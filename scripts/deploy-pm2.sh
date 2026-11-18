#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PM2_NAME="healthystudy-intranet-service"
cd "$APP_DIR"

echo "==> Deploying $PM2_NAME in $APP_DIR"

for cmd in node pnpm pm2 curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required command '$cmd' is not installed or not on PATH." >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js >= 20 is required (found $(node -v))." >&2
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "ERROR: .env not found in $APP_DIR. Copy .env.production.example to .env and set secrets first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

PORT="${PORT:-3004}"

if [ "${NODE_ENV:-production}" = "production" ]; then
  for required_var in JWT_SECRET INTERNAL_SERVICE_SECRET DB_NAME IMAGEKIT_PRIVATE_KEY IMAGEKIT_URL_ENDPOINT; do
    val="${!required_var:-}"
    if [ -z "$val" ] || [[ "$val" == CHANGE_ME_* ]] || [[ "$val" == *"/dummy" ]]; then
      echo "ERROR: $required_var is missing or still uses a placeholder value in .env." >&2
      exit 1
    fi
  done
  if [ -z "${DATABASE_URL:-}" ] && { [ -z "${DB_PASSWORD:-}" ] || [[ "${DB_PASSWORD:-}" == CHANGE_ME_* ]]; }; then
    echo "ERROR: DB_PASSWORD is missing or still uses a placeholder value in .env." >&2
    exit 1
  fi
fi

if [ -d ".git" ] && [ "${SKIP_GIT_PULL:-0}" != "1" ]; then
  echo "==> Pulling latest master branch..."
  git pull --ff-only origin master
fi

echo "==> Installing dependencies with pnpm (frozen lockfile)..."
pnpm install --frozen-lockfile --ignore-scripts

echo "==> Building NestJS application..."
NODE_OPTIONS="--max-old-space-size=1024" pnpm run build

echo "==> Ensuring PostgreSQL database exists (when DB_AUTO_CREATE=true)..."
node -e "require('./dist/database/data-source').ensureDatabaseFromEnv().catch((err)=>{console.error(err);process.exit(1)})"

echo "==> Running idempotent database migrations..."
pnpm run migration:run

echo "==> Starting / restarting PM2 process..."
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo "==> Waiting for healthcheck on http://127.0.0.1:${PORT}/health ..."
for attempt in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "==> Healthcheck OK:"
    curl -fsS "http://127.0.0.1:${PORT}/health"
    echo ""
    echo "==> Weather endpoint quick check:"
    curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/weather?city=Tashkent&days=2&pastDays=0" | head -c 300
    echo ""
    echo "==> Deploy completed successfully."
    exit 0
  fi
  sleep 1
done

echo "ERROR: Service did not pass /health within 20 seconds. Recent PM2 logs:" >&2
pm2 logs "$PM2_NAME" --lines 40 --nostream || true
exit 1
