import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Adds invoice-level projections without changing applied Membership migrations. */
export class Migration20260804010000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "membership_subscription" drop constraint if exists "membership_subscription_status_check";');
    this.addSql('alter table "membership_subscription" add constraint "membership_subscription_status_check" check ("status" in (\'incomplete\', \'active\', \'past_due\', \'canceled\', \'trialing\', \'unpaid\', \'paused\', \'incomplete_expired\'));');
    this.addSql('create table if not exists "membership_billing_cycle" ("id" text not null, "membership_subscription_id" text not null, "stripe_invoice_id" text not null, "stripe_event_id" text null, "order_id" text null, "payment_id" text null, "fulfillment_id" text null, "currency_code" text not null, "subtotal" text not null, "tax_total" text not null, "total" text not null, "status" text check ("status" in (\'pending\', \'paid\', \'failed\', \'action_required\')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "membership_billing_cycle_pkey" primary key ("id"), constraint "membership_billing_cycle_membership_subscription_id_foreign" foreign key ("membership_subscription_id") references "membership_subscription" ("id") on update cascade);');
    this.addSql('create unique index if not exists "IDX_membership_billing_cycle_invoice" on "membership_billing_cycle" ("stripe_invoice_id") where deleted_at is null;');
    this.addSql('create unique index if not exists "IDX_membership_billing_cycle_order" on "membership_billing_cycle" ("order_id") where order_id is not null and deleted_at is null;');
    this.addSql('create unique index if not exists "IDX_membership_billing_cycle_payment" on "membership_billing_cycle" ("payment_id") where payment_id is not null and deleted_at is null;');
    this.addSql('create unique index if not exists "IDX_membership_billing_cycle_fulfillment" on "membership_billing_cycle" ("fulfillment_id") where fulfillment_id is not null and deleted_at is null;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "membership_billing_cycle" cascade;');
  }
}
