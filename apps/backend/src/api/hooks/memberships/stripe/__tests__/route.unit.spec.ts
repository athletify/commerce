jest.mock("../../../../../modules/membership/stripe", () => ({
  stripe: { webhooks: { constructEvent: jest.fn() } },
  membershipStatus: (status: string) => status,
  stripeAmountToMajor: (amount: number, currency: string) => amount / (currency === "jpy" ? 1 : 100),
  stripeDate: () => null,
}));

jest.mock("../../../../../../default.env", () => ({
  StripeConfig: { membershipWebhookSecret: "whsec_membership_test" },
}));

jest.mock("@medusajs/medusa/core-flows", () => ({
  createOrderWorkflow: jest.fn(),
  createOrderPaymentCollectionWorkflow: jest.fn(),
  createPaymentSessionsWorkflow: jest.fn(),
  processPaymentWorkflow: jest.fn(),
  createFulfillmentWorkflow: jest.fn(),
}));

import { POST } from "../route";
import { stripe } from "../../../../../modules/membership/stripe";
import {
  createFulfillmentWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  createPaymentSessionsWorkflow,
  processPaymentWorkflow,
} from "@medusajs/medusa/core-flows";

describe("membership Stripe webhook", () => {
  it("uses invoice.payment_failed as the source of truth and emits the internal event", async () => {
    const membership = { id: "msub_1", plan_id: "mplan_1", status: "active" };
    const service = {
      listMembershipBillingCycles: jest.fn().mockResolvedValue([]),
      retrieveMembershipBillingCycle: jest.fn().mockResolvedValue({ id: "mcycle_1", status: "failed" }),
      createMembershipBillingCycles: jest.fn().mockResolvedValue({ id: "mcycle_1", status: "failed" }),
      updateMembershipBillingCycles: jest.fn(),
      listStripeWebhookEvents: jest.fn().mockResolvedValue([]),
      listMembershipSubscriptions: jest.fn().mockResolvedValue([membership]),
      retrieveMembershipSubscription: jest.fn().mockResolvedValue(membership),
      updateMembershipSubscriptions: jest.fn().mockResolvedValue({ ...membership, status: "past_due" }),
      listMembershipPlans: jest.fn().mockResolvedValue([{ id: "mplan_1", product_id: "prod_1", variant_id: "variant_1", sales_channel_id: "sc_1" }]),
      retrieveMembershipPlan: jest.fn().mockResolvedValue({ id: "mplan_1", product_id: "prod_1", variant_id: "variant_1", sales_channel_id: "sc_1" }),
      createStripeWebhookEvents: jest.fn(),
    };
    const eventBus = { emit: jest.fn() };
    const locking = { execute: jest.fn(async (_keys: string[], callback: () => Promise<unknown>) => callback()) };
    (stripe as any).webhooks.constructEvent.mockReturnValue({ id: "evt_1", type: "invoice.payment_failed", data: { object: { id: "in_1", object: "invoice", subscription: "sub_1", currency: "usd", subtotal: 0, tax: 0, total: 0 } } });
    const res: any = { json: jest.fn() };
    const req: any = { headers: { "stripe-signature": "sig" }, rawBody: Buffer.from("{}"), scope: { resolve: (key: string) => key === "membership" ? service : key === "locking" ? locking : eventBus } };
    await POST(req, res);
    expect(service.updateMembershipSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ id: "msub_1", status: "past_due" }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ name: "membership.subscription.updated", data: expect.objectContaining({ sales_channel_id: "sc_1", status: "past_due" }) }));
    expect(service.createStripeWebhookEvents).toHaveBeenCalledWith({ stripe_event_id: "evt_1" });
  });

  it("creates the initial order in the membership plan sales channel with Athletify context", async () => {
    const membership = {
      id: "msub_1",
      plan_id: "mplan_1",
      status: "incomplete",
      payment_id: "pay_existing",
      organization_id: "org_1",
      company_id: "company_1",
      stock_location_id: "sloc_1",
      sale_source: "online",
      customer_name: "Ada Lovelace",
      email: "ada@example.com",
      stripe_subscription_id: "sub_1",
    };
    const service = {
      listMembershipBillingCycles: jest.fn().mockResolvedValue([]),
      retrieveMembershipBillingCycle: jest.fn().mockResolvedValue({ id: "mcycle_1", status: "pending", order_id: null, payment_id: "pay_existing", fulfillment_id: null }),
      createMembershipBillingCycles: jest.fn().mockResolvedValue({ id: "mcycle_1", status: "pending", order_id: null, payment_id: "pay_existing", fulfillment_id: null }),
      updateMembershipBillingCycles: jest.fn(),
      listStripeWebhookEvents: jest.fn().mockResolvedValue([]),
      listMembershipSubscriptions: jest.fn().mockResolvedValue([membership]),
      retrieveMembershipSubscription: jest.fn().mockResolvedValue(membership),
      updateMembershipSubscriptions: jest.fn().mockResolvedValue({ ...membership, status: "active" }),
      listMembershipPlans: jest.fn().mockResolvedValue([{
        id: "mplan_1", product_id: "prod_1", variant_id: "variant_1", sales_channel_id: "sc_1", currency_code: "usd", amount: 10.99,
      }]),
      retrieveMembershipPlan: jest.fn().mockResolvedValue({
        id: "mplan_1", product_id: "prod_1", variant_id: "variant_1", sales_channel_id: "sc_1", currency_code: "usd",
      }),
      createStripeWebhookEvents: jest.fn(),
    };
    const query = { graph: jest.fn(async ({ entity }: any) => {
      if (entity === "stock_location") return { data: [{ id: "sloc_1", address: { country_code: "US", province: "CA" } }] };
      if (entity === "tax_region") return { data: [{ id: "txreg_us", province_code: null, tax_rates: [] }] };
      if (entity === "region") return { data: [{ id: "reg_1" }] };
      return { data: [{ id: "order_1", items: [{ id: "orli_1", title: "Membership", variant: { sku: "membership", barcode: "" } }] }] };
    }) };
    const eventBus = { emit: jest.fn() };
    const createOrder = { run: jest.fn().mockResolvedValue({ result: { id: "order_1" } }) };
    const createFulfillment = { run: jest.fn().mockResolvedValue({ result: { id: "ful_1" } }) };
    const orderService = { registerFulfillment: jest.fn() };
    const link = { create: jest.fn() };
    const locking = { execute: jest.fn(async (_keys: string[], callback: () => Promise<unknown>) => callback()) };
    (createOrderWorkflow as unknown as jest.Mock).mockReturnValue(createOrder);
    (createFulfillmentWorkflow as unknown as jest.Mock).mockReturnValue(createFulfillment);
    (stripe as any).webhooks.constructEvent.mockReturnValue({
      id: "evt_active_1",
      type: "invoice.paid",
      data: { object: { id: "in_1", object: "invoice", subscription: "sub_1", currency: "usd", subtotal: 1099, tax: 55, total: 1154 } },
    });
    const res: any = { json: jest.fn() };
    const req: any = {
      headers: { "stripe-signature": "sig" }, rawBody: Buffer.from("{}"),
      scope: { resolve: (key: string) => key === "membership" ? service : key === "event_bus" ? eventBus : key === "order" ? orderService : key === "link" ? link : key === "locking" ? locking : query },
    };

    await POST(req, res);

    expect(createOrder.run).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      sales_channel_id: "sc_1",
      metadata: {
        organization_id: "org_1",
        company_id: "company_1",
        stock_location_id: "sloc_1",
        sale_source: "online",
        athletify_customer_name: "Ada Lovelace",
        membership_subscription_id: "msub_1",
        stripe_subscription_id: "sub_1",
      },
    }) }));
    expect(service.updateMembershipSubscriptions).toHaveBeenCalledWith({ id: "msub_1", order_id: "order_1" });
    expect(createFulfillment.run).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      location_id: "sloc_1",
      provider_id: "manual_manual",
      metadata: expect.objectContaining({ symbolic: true, membership_subscription_id: "msub_1" }),
    }) }));
    expect(orderService.registerFulfillment).toHaveBeenCalledWith(expect.objectContaining({ order_id: "order_1", reference_id: "ful_1" }));
    expect(link.create).toHaveBeenCalled();
    expect(service.updateMembershipSubscriptions).toHaveBeenCalledWith({ id: "msub_1", fulfillment_id: "ful_1" });
  });

  it("serializes retried active webhooks and fulfills the fixed membership quantity without item.quantity", async () => {
    const membership: any = {
      id: "msub_1", plan_id: "mplan_1", status: "incomplete", organization_id: "org_1", company_id: "company_1",
      stock_location_id: "sloc_1", email: "ada@example.com", stripe_subscription_id: "sub_1",
    };
    const cycle: any = { id: "mcycle_1", stripe_invoice_id: "in_1", status: "pending", order_id: null, payment_id: null, fulfillment_id: null };
    const processedEvents = new Set<string>();
    const service = {
      listMembershipBillingCycles: jest.fn().mockImplementation(async () => cycle.stripe_invoice_id ? [{ ...cycle }] : []),
      retrieveMembershipBillingCycle: jest.fn().mockImplementation(async () => ({ ...cycle })),
      createMembershipBillingCycles: jest.fn().mockImplementation(async (data) => Object.assign(cycle, data)),
      updateMembershipBillingCycles: jest.fn().mockImplementation(async (data) => Object.assign(cycle, data)),
      listStripeWebhookEvents: jest.fn(async ({ stripe_event_id }: { stripe_event_id: string }) =>
        processedEvents.has(stripe_event_id) ? [{ id: "mwe_1" }] : []),
      listMembershipSubscriptions: jest.fn().mockImplementation(async () => [{ ...membership }]),
      retrieveMembershipSubscription: jest.fn().mockImplementation(async () => ({ ...membership })),
      updateMembershipSubscriptions: jest.fn().mockImplementation(async (data) => {
        Object.assign(membership, data);
        return { ...membership, status: data.status || membership.status };
      }),
      listMembershipPlans: jest.fn().mockResolvedValue([{
        id: "mplan_1", product_id: "prod_1", variant_id: "variant_1", sales_channel_id: "sc_1", currency_code: "usd", amount: 10.99,
      }]),
      retrieveMembershipPlan: jest.fn().mockResolvedValue({
        id: "mplan_1", product_id: "prod_1", variant_id: "variant_1", sales_channel_id: "sc_1", currency_code: "usd",
      }),
      createStripeWebhookEvents: jest.fn(async ({ stripe_event_id }: { stripe_event_id: string }) => {
        processedEvents.add(stripe_event_id);
        return { id: "mwe_1" };
      }),
    };
    const query = {
      graph: jest.fn().mockImplementation(async ({ entity }: any) => {
        if (entity === "stock_location") return { data: [{ id: "sloc_1", address: { country_code: "US", province: "CA" } }] };
        if (entity === "tax_region") return { data: [
          { id: "txreg_us", province_code: null, tax_rates: [{ id: "txr_us", rate: 5, is_default: true }] },
          { id: "txreg_ca", province_code: "ca", tax_rates: [{ id: "txr_ca", rate: 5, code: "CA", name: "CA sales tax", is_default: true }] },
        ] };
        if (entity === "region") return { data: [{ id: "reg_1" }] };
        if (entity === "payment") return { data: [{ id: "pay_1" }] };
        return { data: [{ id: "order_1", items: [{ id: "orli_1", title: "Membership", variant: { sku: "membership", barcode: "" } }] }] };
      }),
    };
    const eventBus = { emit: jest.fn() };
    const orderService = { registerFulfillment: jest.fn(), upsertOrderLineItemTaxLines: jest.fn() };
    const link = { create: jest.fn() };
    const createOrder = { run: jest.fn().mockResolvedValue({ result: { id: "order_1" } }) };
    const createPaymentCollection = { run: jest.fn().mockResolvedValue({ result: [{ id: "pay_col_1" }] }) };
    const createPaymentSession = { run: jest.fn().mockResolvedValue({ result: { id: "payses_1" } }) };
    const processPayment = { run: jest.fn().mockResolvedValue({ result: {} }) };
    const createFulfillment = { run: jest.fn().mockResolvedValue({ result: { id: "ful_1" } }) };
    (createOrderWorkflow as unknown as jest.Mock).mockReturnValue(createOrder);
    (createOrderPaymentCollectionWorkflow as unknown as jest.Mock).mockReturnValue(createPaymentCollection);
    (createPaymentSessionsWorkflow as unknown as jest.Mock).mockReturnValue(createPaymentSession);
    (processPaymentWorkflow as unknown as jest.Mock).mockReturnValue(processPayment);
    (createFulfillmentWorkflow as unknown as jest.Mock).mockReturnValue(createFulfillment);
    const lockTails = new Map<string, Promise<unknown>>();
    const locking = {
      execute: jest.fn((_keys: string[], callback: () => Promise<unknown>) => {
        const key = _keys.join(":");
        const result = (lockTails.get(key) || Promise.resolve()).then(callback);
        lockTails.set(key, result.catch(() => undefined));
        return result;
      }),
    };
    (stripe as any).webhooks.constructEvent.mockReturnValue({
      id: "evt_active_retry", type: "invoice.paid",
      data: { object: { id: "in_1", object: "invoice", subscription: "sub_1", currency: "usd", subtotal: 1099, tax: 55, total: 1154 } },
    });
    const request = () => ({
      headers: { "stripe-signature": "sig" }, rawBody: Buffer.from("{}"),
      scope: { resolve: (key: string) => key === "membership" ? service : key === "event_bus" ? eventBus : key === "order" ? orderService : key === "link" ? link : key === "locking" ? locking : query },
    } as any);

    await Promise.all([POST(request(), { json: jest.fn() } as any), POST(request(), { json: jest.fn() } as any)]);

    expect(createOrder.run).toHaveBeenCalledTimes(1);
    expect(createOrder.run).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      shipping_address: expect.objectContaining({ country_code: "us", province: "ca" }),
      items: [expect.objectContaining({ unit_price: 10.99 })],
    }) }));
    expect(orderService.upsertOrderLineItemTaxLines).toHaveBeenCalledWith([expect.objectContaining({ tax_rate_id: "txr_ca", rate: 5 })]);
    expect(createPaymentCollection.run).toHaveBeenCalledWith(expect.objectContaining({ input: { order_id: "order_1", amount: 11.54 } }));
    expect(processPayment.run).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ data: expect.objectContaining({ amount: 11.54 }) }) }));
    expect(processPayment.run).toHaveBeenCalledTimes(1);
    expect(createFulfillment.run).toHaveBeenCalledTimes(1);
    expect(createFulfillment.run).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({
      items: [expect.objectContaining({ line_item_id: "orli_1", quantity: 1 })],
    }) }));
    expect(orderService.registerFulfillment).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ id: "orli_1", quantity: 1 }],
    }));
    expect(membership).toMatchObject({ order_id: "order_1", payment_id: "pay_1", fulfillment_id: "ful_1" });
    expect(service.createStripeWebhookEvents).toHaveBeenCalledTimes(1);
  });
});
