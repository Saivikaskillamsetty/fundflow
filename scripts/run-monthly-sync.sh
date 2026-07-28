#!/bin/bash
# Wrapper for the monthly portfolio pipeline (invoked by launchd/cron).
# Logs to logs/monthly-sync.log. Needs Docker (Postgres) running + Chrome.
set -euo pipefail

PROJECT_DIR="/Users/saivikaskillamsetty/Projects/fundflow"
export PATH="/Users/saivikaskillamsetty/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin"

cd "$PROJECT_DIR"
mkdir -p logs
echo "===== $(date) starting monthly-sync =====" >> logs/monthly-sync.log
npm run sync:monthly >> logs/monthly-sync.log 2>&1
echo "===== $(date) finished (exit $?) =====" >> logs/monthly-sync.log
