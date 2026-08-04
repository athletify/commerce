jest.mock("@medusajs/medusa/core-flows", () => ({ createFulfillmentWorkflow: jest.fn() }));

import handler from "../membership-one-time-payment-captured";
import { createFulfillmentWorkflow } from "@medusajs/medusa/core-flows";

describe("one-time membership payment subscriber", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-07-28T12:00:00.000Z")));
  afterEach(() => jest.useRealTimers());

  it("creates one active monthly membership without Stripe IDs and symbolically fulfills only its line", async () => {
    const membership = { id: "msub_1", order_id: "order_1", plan_id: "mplan_1", fulfillment_id: null };
    const membershipService = {
      listMembershipPlans: jest.fn().mockResolvedValue([{ id: "mplan_1", variant_id: "variant_membership", billing_period: "monthly", active: true }]),
      listMembershipSubscriptions: jest.fn().mockResolvedValue([]),
      createMembershipSubscriptions: jest.fn().mockResolvedValue(membership),
      updateMembershipSubscriptions: jest.fn(),
    };
    const query = {
      graph: jest.fn().mockResolvedValue({ data: [{
        id: "pay_1",
        payment_collection: { order: {
          id: "order_1", email: "ada@example.com",
          metadata: { organization_id: "org_1", company_id: "company_1", stock_location_id: "sloc_1", sale_source: "online" },
          items: [
            { id: "item_membership", title: "Monthly membership", variant_id: "variant_membership", variant: { sku: "membership", barcode: "" } },
            { id: "item_physical", title: "Shirt", variant_id: "variant_physical", variant: { sku: "shirt", barcode: "" } },
          ],
        } },
      }] }),
    };
    const createFulfillment = { run: jest.fn().mockResolvedValue({ result: { id: "ful_1" } }) };
    (createFulfillmentWorkflow as unknown as jest.Mock).mockReturnValue(createFulfillment);
    const orderService = { registerFulfillment: jest.fn() };
    const link = { create: jest.fn() };
    const locking = { execute: jest.fn(async (_keys: string[], callback: () => Promise<unknown>) => callback()) };
    const container: any = {
      resolve: (key: string) => key === "query" ? query : key === "membership" ? membershipService : key === "locking" ? locking : key === "order" ? orderService : link,
    };

    await handler({ event: { data: { id: "pay_1" } }, container } as any);

    expect(membershipService.createMembershipSubscriptions).toHaveBeenCalledWith(expect.objectContaining({
      renewal_type: "none",
      status: "active",
      order_id: "order_1",
      plan_id: "mplan_1",
      email: "ada@example.com",
      current_period_start: new Date("2026-07-28T12:00:00.000Z"),
      current_period_end: new Date("2026-08-28T12:00:00.000Z"),
      organization_id: "org_1",
    }));
    const createInput = membershipService.createMembershipSubscriptions.mock.calls[0][0];
    expect(createInput.stripe_customer_id).toBeUndefined();
    expect(createInput.stripe_subscription_id).toBeUndefined();
    expect(createFulfillment.run).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      order: { id: "order_1" },
      items: [expect.objectContaining({ line_item_id: "item_membership", quantity: 1 })],
    }) }));
    expect(orderService.registerFulfillment).toHaveBeenCalledWith(expect.objectContaining({
      order_id: "order_1",
      items: [{ id: "item_membership", quantity: 1 }],
    }));
    expect(membershipService.updateMembershipSubscriptions).toHaveBeenCalledWith({ id: "msub_1", fulfillment_id: "ful_1" });
  });
});
