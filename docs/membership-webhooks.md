# Membership Stripe Webhooks

Membership subscriptions use a webhook endpoint separate from Medusa's
standard payment webhook. Both endpoints must remain active.

| Flow | Endpoint | Environment variable |
| --- | --- | --- |
| Standard Medusa payments | `/hooks/payment/stripe_stripe` | `STRIPE_WEBHOOK_SECRET` |
| Membership subscriptions | `/hooks/memberships/stripe` | `STRIPE_MEMBERSHIP_WEBHOOK_SECRET` |

Never replace the standard payment endpoint or reuse its signing secret for
memberships.

## Local development

The local Docker image starts two Stripe CLI listeners automatically: one for
standard payments and one for memberships. Their generated signing secrets are
kept in the container and exported before Medusa starts.

Start the local stack:

```bash
docker compose up --build -d backend
```

The backend container requires `STRIPE_API_KEY` in `apps/backend/.env`. Do not
set either webhook signing-secret variable locally; the container supplies its
ephemeral listener secrets at startup. Inspect the listener logs with:

```bash
docker compose exec backend cat /tmp/stripe-memberships.log
```

If Docker cannot validate the TLS certificate used by your local network, the
container starts Medusa using the configured webhook secrets instead. In that
case, keep using Stripe CLI on the host and configure Docker Desktop to trust
your network's root CA before relying on embedded listeners.

## Stripe Dashboard deployment

Create a new webhook destination in the Stripe Dashboard. Do not edit the
existing destination for `/hooks/payment/stripe_stripe`.

Use this URL:

```text
https://<MEDUSA_HOST>/hooks/memberships/stripe
```

Select only these events:

```text
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

Copy the new destination's signing secret to the deployment environment as
`STRIPE_MEMBERSHIP_WEBHOOK_SECRET`, then restart the Medusa backend. Keep
`STRIPE_WEBHOOK_SECRET` unchanged.

When rotating the membership webhook secret, deploy the new value before
removing the old Stripe destination to avoid dropped events.

## Verification

1. Create a membership checkout and confirm its PaymentIntent with a Stripe
   test card.
2. Confirm Stripe delivers `invoice.paid` or
   `customer.subscription.updated` to `/hooks/memberships/stripe` with HTTP
   200.
3. Confirm the `membership_subscription` becomes `active`.
4. Confirm it has an `order_id` and that exactly one Medusa order exists with
   metadata containing `membership_subscription_id` and
   `stripe_subscription_id`.

Stripe retries webhooks. The persisted Stripe event ID and the unique
`membership_subscription.order_id` ensure the first paid membership creates
only one order.
