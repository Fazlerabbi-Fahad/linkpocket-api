#!/usr/bin/env bash
# SRS 10.1 step 5: after a production deploy, check health every minute for 30 minutes.
# Three failures in a row fail the job, which is the signal to follow the rollback runbook.
# Error rate and latency are watched on the dashboards at the same time (observability.md).
#   watch.sh <api-url> [minutes]
set -uo pipefail

api="${1%/}"
minutes="${2:-30}"
failures=0
for i in $(seq 1 "$minutes"); do
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${api}/readyz" || echo 000)
  if [ "$status" = "200" ]; then
    failures=0
  else
    failures=$((failures + 1))
    echo "::warning::minute ${i}: /readyz answered ${status} (${failures} in a row)"
    if [ "$failures" -ge 3 ]; then
      echo "::error::/readyz failed 3 times in a row. Follow docs/runbooks/rollback.md."
      exit 1
    fi
  fi
  sleep 60
done
echo "Healthy for ${minutes} minutes"
