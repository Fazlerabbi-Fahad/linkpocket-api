#!/usr/bin/env bash
# Post-deploy smoke test for the API (SRS 10.1 steps 3 and 5): liveness and readiness.
# Uses no credentials and creates no data. The web project checks the API through its origin.
#   smoke.sh <api-url>
set -euo pipefail

api="${1%/}"

check() {
  local name="$1" url="$2" want="$3" status
  status=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' --max-time 15 "$url" || echo 000)
  if [ "$status" != "$want" ]; then
    echo "::error::${name}: ${url} answered ${status}, expected ${want}"
    return 1
  fi
  echo "ok  ${name} (${status})"
}

check "API liveness" "${api}/healthz" 200
check "API readiness" "${api}/readyz" 200
jq -e '.status == "ready" or .status == "degraded"' /tmp/smoke-body >/dev/null
if jq -e '.status == "degraded"' /tmp/smoke-body >/dev/null; then
  echo "::warning::API is degraded: $(cat /tmp/smoke-body)"
fi
check "Signed-out /auth/me" "${api}/api/v1/auth/me" 401
jq -e '.error.code == "UNAUTHENTICATED" and (.error.requestId | length > 0)' /tmp/smoke-body >/dev/null
echo "Smoke test passed"
