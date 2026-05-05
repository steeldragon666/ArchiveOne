#!/usr/bin/env bash
# health-check.sh — Synthetic monitoring health check for CPA Platform (T1.2)
#
# Purpose:
#   Exercises the three critical API endpoints that back the Grafana synthetic
#   uptime probes. Can be run from CI, from a local dev machine for smoke
#   testing, or from a cron job to verify staging/production health.
#
# Usage:
#   ./tools/monitoring/health-check.sh [--env <environment>] [--verbose]
#
# Options:
#   --env     Target environment: production | staging | local (default: local)
#   --verbose Print full response bodies on failure
#   --ci      Exit non-zero on first failure (for CI pipeline use)
#
# Exit codes:
#   0 — All probes passed
#   1 — One or more probes failed
#
# Required env vars (when --env is not local):
#   HEALTH_CHECK_API_URL        — Base URL of the API (without trailing slash)
#   HEALTH_CHECK_SYNTHETIC_JWT  — A long-lived test JWT for the synthetic user
#                                  (read-only, no data mutation permissions)
#   HEALTH_CHECK_TEST_ACTIVITY_ID — A stable activity ID for the timeline probe
#
# Example (local):
#   API_PORT=3000 ./tools/monitoring/health-check.sh --env local
#
# Example (staging in CI):
#   HEALTH_CHECK_API_URL=https://api-staging.cpaplatform.com \
#   HEALTH_CHECK_SYNTHETIC_JWT=$(gcloud secrets versions access latest --secret=synthetic-jwt-staging) \
#   HEALTH_CHECK_TEST_ACTIVITY_ID=01900000-0000-0000-0000-000000000001 \
#   ./tools/monitoring/health-check.sh --env staging --ci

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ENV="${HEALTH_CHECK_ENV:-local}"
VERBOSE=false
CI_MODE=false
OVERALL_PASS=true
FAILED_PROBES=()

# Timeout per request in seconds
REQUEST_TIMEOUT=10

# Response time threshold in milliseconds (probe fails if slower)
LATENCY_WARN_MS=1000   # warn if slower than this
LATENCY_FAIL_MS=5000   # fail if slower than this

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --ci)
      CI_MODE=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------

case "$ENV" in
  production)
    BASE_URL="${HEALTH_CHECK_API_URL:-https://api.cpaplatform.com}"
    ;;
  staging)
    BASE_URL="${HEALTH_CHECK_API_URL:-https://api-staging.cpaplatform.com}"
    ;;
  local)
    BASE_URL="http://localhost:${API_PORT:-3000}"
    ;;
  *)
    echo "Unknown environment: $ENV (expected production | staging | local)" >&2
    exit 1
    ;;
esac

SYNTHETIC_JWT="${HEALTH_CHECK_SYNTHETIC_JWT:-}"
TEST_ACTIVITY_ID="${HEALTH_CHECK_TEST_ACTIVITY_ID:-}"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # no colour

log_pass() { echo -e "${GREEN}PASS${NC} $1"; }
log_fail() { echo -e "${RED}FAIL${NC} $1"; }
log_warn() { echo -e "${YELLOW}WARN${NC} $1"; }
log_info() { echo "INFO $1"; }

# Run a single probe.
# Arguments: probe_name url [extra_curl_args...]
# Returns: 0 on pass, 1 on fail
run_probe() {
  local name="$1"
  local url="$2"
  shift 2
  local extra_args=("$@")

  local start_ms
  start_ms=$(date +%s%3N)

  local http_code
  local response_body
  local curl_exit=0

  # Capture HTTP status code + body; allow non-zero exit (network errors)
  response_body=$(
    curl \
      --silent \
      --max-time "$REQUEST_TIMEOUT" \
      --write-out '\n%{http_code}' \
      "${extra_args[@]}" \
      "$url" 2>&1
  ) || curl_exit=$?

  local end_ms
  end_ms=$(date +%s%3N)
  local elapsed_ms=$(( end_ms - start_ms ))

  if [[ $curl_exit -ne 0 ]]; then
    log_fail "$name — curl error (exit $curl_exit, ${elapsed_ms}ms)"
    if [[ "$VERBOSE" == true ]]; then
      echo "  Response: $response_body"
    fi
    return 1
  fi

  # Last line is the HTTP status code
  http_code=$(echo "$response_body" | tail -n1)
  local body
  body=$(echo "$response_body" | head -n-1)

  # Check HTTP status
  if [[ "$http_code" -ne 200 ]]; then
    log_fail "$name — HTTP $http_code (${elapsed_ms}ms)"
    if [[ "$VERBOSE" == true ]]; then
      echo "  Body: $(echo "$body" | head -c 500)"
    fi
    return 1
  fi

  # Check latency
  if [[ $elapsed_ms -gt $LATENCY_FAIL_MS ]]; then
    log_fail "$name — HTTP $http_code but latency ${elapsed_ms}ms > ${LATENCY_FAIL_MS}ms threshold"
    return 1
  fi

  if [[ $elapsed_ms -gt $LATENCY_WARN_MS ]]; then
    log_warn "$name — HTTP $http_code, latency ${elapsed_ms}ms (above ${LATENCY_WARN_MS}ms warn threshold)"
    # Warnings do not fail the probe
  else
    log_pass "$name — HTTP $http_code, ${elapsed_ms}ms"
  fi

  if [[ "$VERBOSE" == true ]]; then
    echo "  Body snippet: $(echo "$body" | head -c 200)"
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Probe 1: Health check endpoint
# ---------------------------------------------------------------------------
# GET /healthz — unauthenticated; checks DB connectivity.
# Expected response: HTTP 200 with JSON body containing { "status": "ok" }

log_info "Probe 1/3: /healthz"

if ! run_probe "GET /healthz" "${BASE_URL}/healthz" \
    --header "Accept: application/json"; then
  OVERALL_PASS=false
  FAILED_PROBES+=("/healthz")
  if [[ "$CI_MODE" == true ]]; then
    echo "CI mode: exiting on first failure" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Probe 2: Auth me endpoint
# ---------------------------------------------------------------------------
# GET /v1/auth/me — requires a valid session JWT.
# Expected response: HTTP 200 with the synthetic user's profile.
# Skip in local env if no JWT is configured (auth requires a real Supabase session).

log_info "Probe 2/3: /v1/auth/me"

if [[ -z "$SYNTHETIC_JWT" && "$ENV" == "local" ]]; then
  log_warn "GET /v1/auth/me — skipped (no HEALTH_CHECK_SYNTHETIC_JWT set; OK for local)"
else
  AUTH_ARGS=()
  if [[ -n "$SYNTHETIC_JWT" ]]; then
    AUTH_ARGS+=(--header "Authorization: Bearer $SYNTHETIC_JWT")
  fi

  if ! run_probe "GET /v1/auth/me" "${BASE_URL}/v1/auth/me" \
      --header "Accept: application/json" \
      "${AUTH_ARGS[@]}"; then
    OVERALL_PASS=false
    FAILED_PROBES+=("/v1/auth/me")
    if [[ "$CI_MODE" == true ]]; then
      echo "CI mode: exiting on first failure" >&2
      exit 1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Probe 3: Audit timeline endpoint
# ---------------------------------------------------------------------------
# GET /v1/audit/activity/<id>/timeline — exercises a real DB query path.
# Skip if TEST_ACTIVITY_ID is not set.

log_info "Probe 3/3: /v1/audit/activity/<id>/timeline"

if [[ -z "$TEST_ACTIVITY_ID" ]]; then
  log_warn "GET /v1/audit/.../timeline — skipped (no HEALTH_CHECK_TEST_ACTIVITY_ID set)"
else
  TIMELINE_ARGS=()
  if [[ -n "$SYNTHETIC_JWT" ]]; then
    TIMELINE_ARGS+=(--header "Authorization: Bearer $SYNTHETIC_JWT")
  fi

  if ! run_probe "GET /v1/audit/activity/${TEST_ACTIVITY_ID}/timeline" \
      "${BASE_URL}/v1/audit/activity/${TEST_ACTIVITY_ID}/timeline" \
      --header "Accept: application/json" \
      "${TIMELINE_ARGS[@]}"; then
    OVERALL_PASS=false
    FAILED_PROBES+=("/v1/audit/activity/${TEST_ACTIVITY_ID}/timeline")
    if [[ "$CI_MODE" == true ]]; then
      echo "CI mode: exiting on first failure" >&2
      exit 1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
if [[ "$OVERALL_PASS" == true ]]; then
  echo -e "${GREEN}All probes passed.${NC} Environment: $ENV, Base URL: $BASE_URL"
  exit 0
else
  echo -e "${RED}${#FAILED_PROBES[@]} probe(s) failed:${NC} ${FAILED_PROBES[*]}"
  echo "Environment: $ENV, Base URL: $BASE_URL"
  echo ""
  echo "Next steps:"
  echo "  1. Check Sentry for recent errors: https://sentry.io"
  echo "  2. Check Grafana API health dashboard"
  echo "  3. Review Cloud Run logs: gcloud run services logs read cpa-api --region=australia-southeast1"
  echo "  4. Follow the alert runbook: docs/monitoring/alert-runbook.md"
  exit 1
fi
