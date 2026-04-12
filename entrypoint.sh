#!/bin/sh
set -e

# Ensure DB directory exists (Docker volume may be empty on first run)
mkdir -p /app/db

echo "→ Seeding database…"
python scripts/demo_seed.py

echo "→ Starting API…"
exec uvicorn api.main:app --host 0.0.0.0 --port 8000
