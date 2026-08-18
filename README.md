# Medusa B2B Backend

This repository now runs as a headless Medusa backend only. It keeps the custom B2B modules, store APIs, admin APIs, and Medusa admin dashboard, but no longer ships a customer-facing storefront.

## Features

- Company management with employee roles and spending limits
- Approval workflows for company purchases
- Quote management and quote messaging
- Custom store APIs for future web, mobile, or partner clients
- Custom admin APIs and admin dashboard extensions for B2B operations

## Project Layout

- `apps/backend`: the Medusa backend application
- `apps/backend/src/api/store`: customer-facing store API extensions
- `apps/backend/src/api/admin`: admin API extensions
- `apps/backend/src/admin`: custom Medusa admin routes and components
- `apps/backend/src/modules`: custom B2B domain modules

## Local Setup

Prerequisites:

- Node.js 20+
- PostgreSQL 15+
- `pnpm` 9+

1. Install dependencies:

```bash
pnpm install
```

2. Create the backend environment file:

```bash
cp apps/backend/.env.template apps/backend/.env
```

3. Update `apps/backend/.env` with your database URL, secrets, and allowed CORS origins.

4. Run database migrations:

```bash
cd apps/backend
pnpm medusa db:migrate
```

5. Create an admin user:

```bash
cd apps/backend
pnpm medusa user -e admin@test.com -p supersecret
```

6. Start the backend from the repo root:

```bash
pnpm dev
```

The Medusa server and admin dashboard run on `http://localhost:9000`, with the admin UI at `http://localhost:9000/app`.

## Docker

To start the full stack with Docker:

```bash
docker compose up --build
```

That command starts:

- Medusa backend on `http://localhost:9000`
- Medusa admin on `http://localhost:9000/app`
- PostgreSQL with a persistent named volume
- Redis with a persistent named volume

The Docker setup appends `?sslmode=disable` to the internal Postgres URL because Medusa's module migrations otherwise assume SSL for non-`localhost` hostnames such as the Compose service name `postgres`.

Useful follow-up commands:

```bash
docker compose down
docker compose logs -f backend
docker compose exec backend pnpm medusa user -e admin@test.com -p supersecret
```

You can override defaults like `POSTGRES_PASSWORD`, `JWT_SECRET`, `COOKIE_SECRET`, `COOKIE_SECURE`, or `MEDUSA_PORT` by exporting them before running `docker compose up --build`.

For local Docker usage over plain `http://localhost`, keep `COOKIE_SECURE=false` so the admin session cookie can be set by the browser. Set it back to `true` when you run the backend behind HTTPS.

## Environment Variables

`apps/backend/.env` supports:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret used to sign JWT tokens |
| `COOKIE_SECRET` | Secret used to sign auth/session cookies |
| `COOKIE_SECURE` | Whether the session cookie requires HTTPS |
| `STORE_CORS` | Comma-separated origins allowed to call public store APIs |
| `ADMIN_CORS` | Comma-separated origins allowed to load the Medusa admin UI |
| `AUTH_CORS` | Comma-separated origins allowed for authenticated browser flows |
| `STRIPE_API_KEY` | Stripe secret key used by the Medusa Stripe payment provider |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret for Medusa payment webhooks |

If you add an external client later, create a publishable API key in the admin dashboard and point that client to this backend's `/store/*` endpoints.

## Recurring Memberships

This implementation keeps them in the isolated `membership` module and does not modify the cart or checkout flow for one-time purchases.

First, apply the migration and register a dedicated Stripe webhook pointing to `POST /hooks/memberships/stripe`, using `STRIPE_MEMBERSHIP_WEBHOOK_SECRET`. Select: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and `invoice.payment_action_required`. The signature is verified and event IDs are stored to prevent duplicate processing.

An administrator configures each plan with `POST /admin/membership-plans`:

```json
{
  "product_id": "prod_...",
  "variant_id": "variant_...",
  "sales_channel_id": "sc_...",
  "billing_period": "monthly",
  "active": true
}
```

The backend validates the product, variant, and sales channel; it creates or reuses the Stripe Product and creates a Stripe Price. When the amount or period changes through `POST /admin/membership-plans/:id`, it creates another Price and never changes an existing one.

Athletify backend uses the existing Medusa Secret API Key as its **Athletify backend API key** for the separate flow. These endpoints are not callable with a publishable key or from the browser:

```http
 POST /store/memberships/checkout
Authorization: Basic sk_...:
Idempotency-Key: <a UUID generated once per checkout attempt>
Content-Type: application/json

{
  "plan_id": "mplan_...",
  "email": "athlete@example.com",
  "name": "Ada Athlete",
  "metadata": {
    "organization_id": "org_...",
    "company_id": "company_...",
    "stock_location_id": "sloc_...",
    "sale_source": "online"
  }
}
```

Keep the same `Idempotency-Key` for retries of the same checkout attempt. Medusa forwards it to Stripe, preventing duplicate Customers and Subscriptions after a network timeout.

```json
{
  "membership_subscription_id": "msub_...",
  "client_secret": "pi_..._secret_...",
  "status": "incomplete"
}
```

Confirm `client_secret` with Stripe Elements. Then Athletify backend calls `GET /store/memberships/msub_...` with the same Athletify backend API key to retrieve the status, product, variant, and `next_billing_at`. Products with an active plan include `membership: { plan_id, billing_period, amount, currency_code }` in standard `/store/products` responses.

To cancel, Athletify backend calls `POST /store/memberships/:id/cancel` with the same Athletify backend API key. A cancellation reason is required; it is stored on the MembershipSubscription and in Stripe metadata. Cancellation is scheduled at the end of the current billing period by default. Pass `"immediately": true` to cancel now:

```json
{
  "reason": "No longer needed",
  "immediately": false
}
```

The only intentional limitation is that a plan uses a fixed variant price without price rules: a single Stripe Price cannot represent Medusa's regional or dynamic pricing rules. For products with multiple recurring variants, the catalog exposes the first active plan for the product; the client must use that `plan_id` explicitly.

See [Membership Stripe Webhooks](./docs/membership-webhooks.md) for local Stripe CLI setup and production Stripe Dashboard configuration.

## Notes

- This codebase remains headless even with the Medusa admin dashboard enabled.
- Removing the storefront does not remove the custom store APIs; those endpoints are still the contract for future clients.
- Quote, approval, and company workflows are still managed by the backend modules in `apps/backend/src`.

## Resources

- [Medusa Documentation](https://docs.medusajs.com)
- [Medusa B2B Commerce Recipe](https://docs.medusajs.com/resources/recipes/b2b)
- [Discord Community](https://discord.gg/xpCwq3Kfn8)

## License

Licensed under the [MIT License](./LICENSE).
