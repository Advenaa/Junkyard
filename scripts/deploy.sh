#!/usr/bin/env bash
# Manual deploy script — run on VPS: bash scripts/deploy.sh
# CI uses the same logic via GitHub Actions
set -euo pipefail

cd "$(dirname "$0")/.."

OLD_HASH=$(git rev-parse HEAD)
echo "==> Current: $OLD_HASH"

echo "==> Pulling latest..."
git fetch origin main
git reset --hard origin/main

echo "==> Installing dependencies..."
npm ci --production=false
cd dashboard && npm ci && cd ..

echo "==> Building..."
if ! npm run build; then
  echo "!!! BUILD FAILED — rolling back to $OLD_HASH"
  git checkout "$OLD_HASH"
  npm ci --production=false
  cd dashboard && npm ci && cd ..
  npm run build
  echo "!!! Rolled back to $OLD_HASH"
  exit 1
fi

echo "==> Running migrations..."
if ! node dist/index.js migrate; then
  echo "!!! MIGRATION FAILED — rolling back to $OLD_HASH"
  git checkout "$OLD_HASH"
  npm ci --production=false
  cd dashboard && npm ci && cd ..
  npm run build
  echo "!!! Rolled back to $OLD_HASH"
  exit 1
fi

echo "==> Restarting pm2..."
pm2 restart ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs
pm2 save

echo "==> Health check..."
for i in $(seq 1 6); do
  if curl -sf http://localhost:3000/api/v1/status > /dev/null 2>&1; then
    echo "==> Health check passed"
    echo "==> Deployed: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 5
done

echo "!!! HEALTH CHECK FAILED — server did not come up within 30s"
exit 1
