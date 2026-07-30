#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f ".env" ]]; then
  echo "Missing serverless/.env. Copy serverless/.env.example to serverless/.env and fill it in." >&2
  exit 1
fi

env_value() {
  local name="$1"
  local line
  line="$(grep -E "^${name}=" .env | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf "%s" "$line"
}

required_vars=(
  TWILIO_SERVERLESS_SERVICE_NAME
  FLEX_WORKFLOW_SID
  LIVEKIT_SIP_HOST
  LIVEKIT_PHONE_NUMBER
  LIVEKIT_SIP_USERNAME
  LIVEKIT_SIP_PASSWORD
  HANDOFF_TOKEN
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "$(env_value "$var_name")" ]]; then
    echo "Missing required env var: ${var_name}" >&2
    exit 1
  fi
done

service_name="$(env_value TWILIO_SERVERLESS_SERVICE_NAME)"
twilio_profile="$(env_value TWILIO_PROFILE)"
flex_workflow_sid="$(env_value FLEX_WORKFLOW_SID)"

if [[ ! "$flex_workflow_sid" =~ ^WW[[:xdigit:]]{32}$ ]]; then
  echo "FLEX_WORKFLOW_SID must be a TaskRouter Workflow SID that starts with WW." >&2
  echo "It is not the Flex TaskRouter Workspace SID, which starts with WS." >&2
  exit 1
fi

if ! command -v twilio >/dev/null 2>&1; then
  echo "Twilio CLI is not installed. Install it, then run: twilio login" >&2
  exit 1
fi

if ! twilio plugins | grep -q "@twilio-labs/plugin-serverless"; then
  echo "Twilio Serverless plugin is missing." >&2
  echo "Install it with: twilio plugins:install @twilio-labs/plugin-serverless" >&2
  exit 1
fi

deploy_args=(
  serverless:deploy
  --service-name "$service_name"
  --env .env
  --override-existing-project
)

if [[ -n "$twilio_profile" ]]; then
  deploy_args+=(-p "$twilio_profile")
fi

twilio "${deploy_args[@]}"
