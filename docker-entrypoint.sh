#!/bin/sh
set -eu

echo "Preparing Frameo database..."
npx prisma db push --skip-generate
npx tsx prisma/seed.ts

echo "Starting Frameo on port ${PORT:-3000}..."
exec node server.js
