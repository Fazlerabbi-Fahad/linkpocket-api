#!/usr/bin/env bash
# Deploys one commit to a Render service and waits until it is live (SRS 10.1 steps 3 and 4).
# Migrations run in the service's pre-deploy command, inside Render (render.yaml).
#   RENDER_API_KEY=... render-deploy.sh <service-id> <commit-sha>
set -euo pipefail

service_id="$1"
commit="$2"
api="https://api.render.com/v1/services/${service_id}/deploys"
auth=(-H "Authorization: Bearer ${RENDER_API_KEY:?RENDER_API_KEY is not set}" -H 'Accept: application/json')

deploy_id=$(curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$api" \
  -d "{\"commitId\":\"${commit}\",\"clearCache\":\"do_not_clear\"}" | jq -r '.id')
echo "Render deploy ${deploy_id} started for ${commit}"

# Up to 25 minutes: build, pre-deploy (migrations), then the zero-downtime switch.
for _ in $(seq 1 100); do
  status=$(curl -fsS "${auth[@]}" "${api}/${deploy_id}" | jq -r '.status')
  case "$status" in
    live)
      echo "Render deploy ${deploy_id} is live"
      exit 0
      ;;
    build_failed | update_failed | pre_deploy_failed | canceled | deactivated)
      echo "::error::Render deploy ${deploy_id} ended with status ${status}"
      exit 1
      ;;
  esac
  sleep 15
done
echo "::error::Render deploy ${deploy_id} did not go live within 25 minutes"
exit 1
