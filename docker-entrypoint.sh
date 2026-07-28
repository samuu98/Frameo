#!/bin/sh
set -eu

echo "Preparing Frameo database..."
prisma db push --skip-generate
tsx prisma/seed.ts

echo "Starting Frameo on port ${PORT:-3000}..."
exec node server.js
