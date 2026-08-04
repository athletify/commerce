#!/bin/sh

#This script is used to start Medusa in a local development environment with Stripe listeners.

set -eu

if [ -z "${STRIPE_API_KEY:-}" ]; then
  echo "STRIPE_API_KEY is required for local Stripe listeners" >&2
  exit 1
fi

payments_pid=""
memberships_pid=""
medusa_pid=""

cleanup() {
  for pid in "$medusa_pid" "$payments_pid" "$memberships_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup INT TERM EXIT

start_listener() {
  name="$1"
  forward_to="$2"
  events="${3:-}"
  log_file="/tmp/stripe-${name}.log"

  if [ -n "$events" ]; then
    stripe listen --api-key "$STRIPE_API_KEY" --skip-update --events "$events" --forward-to "$forward_to" >"$log_file" 2>&1 &
  else
    stripe listen --api-key "$STRIPE_API_KEY" --skip-update --forward-to "$forward_to" >"$log_file" 2>&1 &
  fi
  pid="$!"

  attempt=0
  secret=""
  while [ "$attempt" -lt 60 ]; do
    secret="$(grep -Eo 'whsec_[[:alnum:]_]+' "$log_file" 2>/dev/null | head -n 1 || true)"
    if [ -n "$secret" ]; then
      STRIPE_LISTENER_PID="$pid"
      STRIPE_LISTENER_SECRET="$secret"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      cat "$log_file" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  echo "Timed out waiting for the Stripe ${name} listener" >&2
  cat "$log_file" >&2
  return 1
}

membership_events="customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed"
if start_listener payments http://127.0.0.1:9000/hooks/payment/stripe_stripe; then
  payments_pid="$STRIPE_LISTENER_PID"
  export STRIPE_WEBHOOK_SECRET="$STRIPE_LISTENER_SECRET"

  if start_listener memberships http://127.0.0.1:9000/hooks/memberships/stripe "$membership_events"; then
    memberships_pid="$STRIPE_LISTENER_PID"
    export STRIPE_MEMBERSHIP_WEBHOOK_SECRET="$STRIPE_LISTENER_SECRET"
    echo "Stripe payment and membership listeners are ready"
  else
    echo "Membership Stripe listener is unavailable; using configured webhook secrets" >&2
    kill "$payments_pid" 2>/dev/null || true
    payments_pid=""
  fi
else
  echo "Stripe CLI is unavailable; using configured webhook secrets" >&2
fi
pnpm medusa db:migrate --execute-all-links
pnpm medusa start --host 0.0.0.0 --port 9000 &
medusa_pid="$!"
wait "$medusa_pid"
