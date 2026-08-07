import { AdminCreateMembershipPlan } from "../validators";

describe("Membership plan billing period validation", () => {
  const input = {
    product_id: "prod_1",
    variant_id: "variant_1",
    sales_channel_id: "sc_1",
  };

  it.each(["weekly", "biweekly", "monthly", "yearly"])("accepts %s", (billingPeriod) => {
    expect(AdminCreateMembershipPlan.parse({ ...input, billing_period: billingPeriod }).billing_period).toBe(billingPeriod);
  });
});
