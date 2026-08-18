import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260728140000 extends Migration {
  async up(): Promise<void> {
    this.addSql('create table if not exists "membership_plan" ("id" text not null, "product_id" text not null, "variant_id" text not null, "sales_channel_id" text not null, "billing_period" text check ("billing_period" in (\'monthly\', \'yearly\')) not null, "stripe_product_id" text not null, "stripe_price_id" text not null, "amount" numeric not null, "raw_amount" jsonb not null, "currency_code" text not null, "active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "membership_plan_pkey" primary key ("id"));');
    this.addSql('create unique index if not exists "IDX_membership_plan_variant" on "membership_plan" ("variant_id") where deleted_at is null;');
    this.addSql('create index if not exists "IDX_membership_plan_channel_active" on "membership_plan" ("sales_channel_id", "active") where deleted_at is null;');
    this.addSql('create table if not exists "membership_subscription" ("id" text not null, "plan_id" text not null, "renewal_type" text check ("renewal_type" in (\'recurring\', \'none\')) not null default \'recurring\', "stripe_customer_id" text null, "stripe_subscription_id" text null, "order_id" text null, "payment_id" text null, "fulfillment_id" text null, "organization_id" text null, "company_id" text null, "stock_location_id" text null, "sale_source" text null, "cancellation_reason" text null, "cancellation_requested_at" timestamptz null, "customer_name" text null, "email" text not null, "status" text check ("status" in (\'incomplete\', \'active\', \'past_due\', \'canceled\')) not null, "current_period_start" timestamptz null, "current_period_end" timestamptz null, "cancel_at_period_end" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "membership_subscription_pkey" primary key ("id"), constraint "membership_subscription_plan_id_foreign" foreign key ("plan_id") references "membership_plan" ("id") on update cascade);');
    this.addSql('create unique index if not exists "IDX_membership_subscription_stripe" on "membership_subscription" ("stripe_subscription_id") where deleted_at is null;');
    this.addSql('create index if not exists "IDX_membership_subscription_plan" on "membership_subscription" ("plan_id") where deleted_at is null;');
    this.addSql('create unique index if not exists "IDX_membership_subscription_order_plan" on "membership_subscription" ("order_id", "plan_id") where order_id is not null and deleted_at is null;');
    this.addSql('create unique index if not exists "IDX_membership_subscription_payment" on "membership_subscription" ("payment_id") where payment_id is not null and deleted_at is null;');
    this.addSql('create unique index if not exists "IDX_membership_subscription_fulfillment" on "membership_subscription" ("fulfillment_id") where fulfillment_id is not null and deleted_at is null;');
    this.addSql('create table if not exists "stripe_webhook_event" ("id" text not null, "stripe_event_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "stripe_webhook_event_pkey" primary key ("id"));');
    this.addSql('create unique index if not exists "IDX_stripe_webhook_event_id" on "stripe_webhook_event" ("stripe_event_id") where deleted_at is null;');
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "stripe_webhook_event" cascade;');
    this.addSql('drop table if exists "membership_subscription" cascade;');
    this.addSql('drop table if exists "membership_plan" cascade;');
  }
}
