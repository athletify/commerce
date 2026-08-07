# Memberships: production hardening checklist

This document covers the work required before enabling recurring Memberships in production.

## Scope and environment boundaries

- Docker, the embedded Stripe CLI, and `stripe listen` are local-development tooling only. They must not run in production.
- The default Stripe key in `apps/backend/default.env.ts` is acceptable only for development and staging. Production must inject `STRIPE_API_KEY` through its secret manager and must never fall back to a source-controlled key.
- Production webhooks are configured in the Stripe Dashboard, not through Stripe CLI. See [Membership Stripe Webhooks](./membership-webhooks.md).

## 1. Remove production fallbacks for Stripe credentials

Before production, change the configuration so it fails at startup when any required production secret is absent:

- `STRIPE_API_KEY`
- `STRIPE_WEBHOOK_SECRET` for Medusa's standard payment webhook
- `STRIPE_MEMBERSHIP_WEBHOOK_SECRET` for `/hooks/memberships/stripe`

Store these values in the deployment platform's secret manager. Do not commit them, print them in logs, or expose them to the Store API.

## 2. Authenticate and authorize the membership context

`POST /store/memberships/checkout` currently accepts:

```json
{
  "metadata": {
    "organization_id": "...",
    "company_id": "...",
    "stock_location_id": "...",
    "sale_source": "online"
  }
}
```

For production, these values must not be trusted solely because they were sent by the client. The backend must derive them from a verified Athletify identity, or verify a signed server-to-server assertion.

Required checks:

1. The caller is authorized for `organization_id` and `company_id`.
2. The company belongs to the organization.
3. The stock location belongs to the same organization/company scope.
4. The Membership Plan's `sales_channel_id` belongs to the caller's authorized scope and to the publishable-key context.
5. `sale_source` remains server-controlled as `online`.

Reject mismatches with `403`; do not reveal whether another organization, company, or plan exists.

## 3. Persist checkout idempotency beyond Stripe's retention window

The backend currently requires `Idempotency-Key` and forwards it to Stripe. This protects retries during Stripe's idempotency retention window, but production needs a durable local record as well.

Create a `membership_checkout_attempt` record (or equivalent) with:

- a unique `idempotency_key` scoped to the organization;
- request fingerprint: plan, customer email, organization, company, and stock location;
- Stripe Customer and Subscription IDs once available;
- MembershipSubscription ID;
- state: `started`, `stripe_created`, `completed`, or `failed`;
- error code and timestamps.

Use a database transaction or row-level lock to ensure exactly one attempt can initialize a checkout for a given key. A repeated key with a different fingerprint must return `409 Conflict`. A repeated key with the same fingerprint must return the original checkout result, not create another Stripe Subscription.

## 4. Make webhook processing transactionally idempotent

Membership orders already have a unique membership-order association. Before production, also make the payment path safe when Stripe delivers multiple events concurrently:

- lock the `MembershipSubscription` row while creating its initial order and payment collection;
- use a unique constraint or durable processing record for the initial invoice/payment;
- reuse an existing payment collection/session when present;
- store the Stripe event ID only after the local transaction completes;
- make all side effects safe to replay after a process crash.

Test duplicate delivery of `customer.subscription.updated` and `invoice.paid` concurrently and verify that exactly one order and one initial payment are produced.

## 5. Use production-grade Stripe timeouts and error handling

The current Stripe client uses a 10-second timeout so Athletify receives a bounded response. Make the value environment-configurable, for example `STRIPE_REQUEST_TIMEOUT_MS`, and keep Athletify's request timeout higher than that value.

Map errors deliberately:

- Stripe timeout/network failure: `504` or `502`, safe to retry with the same `Idempotency-Key`.
- Invalid Stripe request or invalid plan configuration: non-retryable `4xx`/`422` response.
- Card authentication or payment confirmation failure: handle in the client through the PaymentIntent; do not create another subscription.
- Internal database failure after Stripe succeeds: return a retryable response and reconcile from the durable checkout attempt.

Log structured fields only: request ID, checkout attempt ID, organization ID, MembershipSubscription ID, Stripe object IDs, operation name, elapsed time, and error category. Never log card data, client secrets, or webhook secrets.

## 6. Configure Stripe Dashboard webhooks

Create a dedicated production endpoint:

```text
https://<MEDUSA_HOST>/hooks/memberships/stripe
```

Subscribe only to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Save its signing secret as `STRIPE_MEMBERSHIP_WEBHOOK_SECRET`. Keep the standard Medusa payment webhook and `STRIPE_WEBHOOK_SECRET` unchanged; both endpoints must coexist.

Apply Stripe's production retry guidance and configure alerting for repeated webhook delivery failures.

## 7. Observability and reconciliation

Before launch, add dashboards and alerts for:

- membership checkout latency, timeouts, and error rate;
- Stripe API failures by operation;
- webhook delivery failures and processing latency;
- subscriptions active in Stripe but missing a MembershipSubscription;
- active MembershipSubscriptions without an order or without a captured initial payment;
- duplicate order/payment prevention events.

Run a scheduled reconciliation job that compares Stripe subscriptions/invoices against Medusa MembershipSubscriptions, orders, and payments. It must be idempotent and alert before changing data automatically.

## 8. Release verification

Execute these scenarios in a production-like environment before release:

1. New membership: one Stripe Customer, Subscription, MembershipSubscription, paid Medusa order, and one symbolic fulfillment from the configured stock location. It must not reserve or decrement inventory.
2. Network timeout after Stripe accepts the request: retry with the same `Idempotency-Key`; no duplicate customer, subscription, membership, order, or payment.
3. Concurrent duplicate webhook delivery: exactly one order and one payment.
4. Failed first payment: MembershipSubscription becomes `past_due`; no paid order is recorded.
5. Cancellation: MembershipSubscription becomes `canceled` while historical order/payment records remain intact.
6. Cross-organization request: receives `403` and creates no Stripe or Medusa records.
7. Restart during checkout or webhook processing: reconciliation safely completes the state.

## Production exit criteria

Do not enable production memberships until every item above is implemented, tested, and observable. The local Docker/Stripe CLI workflow remains useful for development but is not part of the production architecture.
