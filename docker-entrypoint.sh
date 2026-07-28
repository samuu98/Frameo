#!/bin/sh
set -eu

echo "Preparing Frameo database..."
prisma db push --skip-generate

if [ "${FRAMEO_SEED_DEMO:-false}" = "true" ]; then
  echo "Loading optional demo data..."
  tsx prisma/seed.ts
fi

echo "Starting Frameo on port ${PORT:-3000}..."
exec node server.js
