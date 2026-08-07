import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Extends Membership plan periods without changing the original applied migration. */
export class Migration20260807010000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "membership_plan" drop constraint if exists "membership_plan_billing_period_check";');
    this.addSql('alter table "membership_plan" add constraint "membership_plan_billing_period_check" check ("billing_period" in (\'weekly\', \'biweekly\', \'monthly\', \'yearly\'));');
  }

  async down(): Promise<void> {
    this.addSql('alter table "membership_plan" drop constraint if exists "membership_plan_billing_period_check";');
    this.addSql('alter table "membership_plan" add constraint "membership_plan_billing_period_check" check ("billing_period" in (\'monthly\', \'yearly\'));');
  }
}
