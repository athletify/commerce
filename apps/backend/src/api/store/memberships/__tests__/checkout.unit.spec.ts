jest.mock("../../../../modules/membership/stripe", () => ({
  stripe: {
    customers: { list: jest.fn(), create: jest.fn() },
    subscriptions: { create: jest.fn() },
    accounts: { retrieve: jest.fn() },
  },
  membershipStatus: (status: string) => status,
  stripeDate: () => null,
}));

import { POST } from "../checkout/route";
import { stripe } from "../../../../modules/membership/stripe";

const response = () => {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe("membership checkout", () => {
  const plan = { id: "mplan_1", active: true, sales_channel_id: "sc_allowed", stripe_price_id: "price_1", product_id: "prod_1", variant_id: "variant_1" };
  const metadata = { organization_id: "org_1", company_id: "company_1", stock_location_id: "sloc_1", sale_source: "online" as const };
  const scopeFor = (membershipService: any, connectedAccount = "acct_destination") => ({
    resolve: (key: string) => {
      if (key === "membership") return {
        ...membershipService,
        retrieveMembershipPlan: membershipService.retrieveMembershipPlan || jest.fn().mockResolvedValue(plan),
        retrieveMembershipSubscription: membershipService.retrieveMembershipSubscription || jest.fn().mockImplementation(async () => {
          const subscriptions = await membershipService.listMembershipSubscriptions?.({});
          return subscriptions?.[0];
        }),
      };
      if (key === "query") return { graph: jest.fn(async ({ entity }: any) => {
        if (entity === "sales_channel") return { data: [{ id: "sc_allowed", metadata: { athletify_stripe_connected_account_id: connectedAccount } }] };
        if (entity === "stock_location") return { data: [{ id: "sloc_1", address: { country_code: "US", province: "CA" } }] };
        return { data: [] };
      }) };
      return { info: jest.fn(), warn: jest.fn() };
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (stripe as any).accounts.retrieve
      .mockResolvedValueOnce({ id: "acct_destination", payouts_enabled: true, capabilities: { transfers: "active" } })
      .mockResolvedValueOnce({ id: "acct_platform" });
  });

  it("rejects a plan outside the publishable key sales channel", async () => {
    const membershipService = { listMembershipPlans: jest.fn().mockResolvedValue([plan]) };
    const req: any = { headers: { "idempotency-key": "checkout_1" }, auth_context: { actor_id: "cus_1" }, validatedBody: { plan_id: plan.id, email: "a@b.test", name: "Ada", metadata }, publishable_key_context: { sales_channel_ids: ["sc_other"] }, scope: scopeFor(membershipService) };
    const res = response();
    await POST(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect((stripe as any).subscriptions.create).not.toHaveBeenCalled();
  });

  it("creates a Stripe subscription only from the server-side plan price", async () => {
    const membershipService = { listMembershipPlans: jest.fn().mockResolvedValue([plan]), listMembershipSubscriptions: jest.fn().mockResolvedValue([]), createMembershipSubscriptions: jest.fn().mockResolvedValue({ id: "msub_1", status: "incomplete" }) };
    (stripe as any).customers.list.mockResolvedValue({ data: [] });
    (stripe as any).customers.create.mockResolvedValue({ id: "cus_1" });
    (stripe as any).subscriptions.create.mockResolvedValue({ id: "sub_1", status: "incomplete", current_period_start: 0, current_period_end: 0, cancel_at_period_end: false, latest_invoice: { payment_intent: { client_secret: "pi_secret" } } });
    const req: any = { headers: { "idempotency-key": "checkout_1" }, auth_context: { actor_id: "cus_1" }, validatedBody: { plan_id: plan.id, email: "a@b.test", name: "Ada", metadata }, publishable_key_context: { sales_channel_ids: ["sc_allowed"] }, scope: scopeFor(membershipService) };
    const res = response();
    await POST(req, res);
    expect((stripe as any).subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: "price_1" }],
        transfer_data: { destination: "acct_destination" },
        metadata: expect.objectContaining({
          athletify_organization_id: "org_1",
          athletify_company_id: "company_1",
          athletify_stock_location_id: "sloc_1",
          athletify_sale_source: "online",
          athletify_membership_plan_id: "mplan_1",
          athletify_product_id: "prod_1",
          athletify_variant_id: "variant_1",
          athletify_sales_channel_id: "sc_allowed",
        }),
      }),
      { idempotencyKey: "membership-checkout:checkout_1:subscription" }
    );
    expect((stripe as any).customers.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        athletify_organization_id: "org_1",
        athletify_sales_channel_id: "sc_allowed",
      }),
    }), { idempotencyKey: "membership-checkout:checkout_1:customer" });
    expect(membershipService.createMembershipSubscriptions).toHaveBeenCalledWith(expect.objectContaining({
      customer_name: "Ada",
      organization_id: "org_1",
      company_id: "company_1",
      stock_location_id: "sloc_1",
      sale_source: "online",
    }));
    expect(res.json).toHaveBeenCalledWith({ membership_subscription_id: "msub_1", client_secret: "pi_secret", status: "incomplete" });
  });

  it("rejects a membership checkout before Stripe when its sales channel has no connected account", async () => {
    const membershipService = { listMembershipPlans: jest.fn().mockResolvedValue([plan]) };
    const req: any = { headers: { "idempotency-key": "checkout_connect_missing" }, auth_context: { actor_id: "cus_1" }, validatedBody: { plan_id: plan.id, email: "a@b.test", name: "Ada", metadata }, publishable_key_context: { sales_channel_ids: ["sc_allowed"] }, scope: scopeFor(membershipService, "") };
    const res = response();
    await POST(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ message: "Connected Account ID missing or invalid" });
    expect((stripe as any).subscriptions.create).not.toHaveBeenCalled();
  });

  it("creates a platform subscription without transfer_data when the sales channel uses the platform account", async () => {
    const membershipService = { listMembershipPlans: jest.fn().mockResolvedValue([plan]), listMembershipSubscriptions: jest.fn().mockResolvedValue([]), createMembershipSubscriptions: jest.fn().mockResolvedValue({ id: "msub_1", status: "incomplete" }) };
    (stripe as any).accounts.retrieve.mockReset()
      .mockResolvedValueOnce({ id: "acct_platform", payouts_enabled: true, capabilities: { transfers: "active" } })
      .mockResolvedValueOnce({ id: "acct_platform" });
    (stripe as any).customers.list.mockResolvedValue({ data: [] });
    (stripe as any).customers.create.mockResolvedValue({ id: "cus_1" });
    (stripe as any).subscriptions.create.mockResolvedValue({ id: "sub_1", status: "incomplete", current_period_start: 0, current_period_end: 0, cancel_at_period_end: false, latest_invoice: { payment_intent: { client_secret: "pi_secret" } } });
    const req: any = { headers: { "idempotency-key": "checkout_platform" }, auth_context: { actor_id: "cus_1" }, validatedBody: { plan_id: plan.id, email: "a@b.test", name: "Ada", metadata }, publishable_key_context: { sales_channel_ids: ["sc_allowed"] }, scope: scopeFor(membershipService, "acct_platform") };
    const res = response();

    await POST(req, res);

    expect((stripe as any).subscriptions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ transfer_data: expect.anything() }),
      { idempotencyKey: "membership-checkout:checkout_platform:subscription" }
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects checkout without an idempotency key before calling Stripe", async () => {
    const membershipService = { listMembershipPlans: jest.fn() };
    const req: any = { headers: {}, validatedBody: { plan_id: plan.id, email: "a@b.test", name: "Ada", metadata }, publishable_key_context: { sales_channel_ids: ["sc_allowed"] }, scope: scopeFor(membershipService) };
    const res = response();
    await POST(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(membershipService.listMembershipPlans).not.toHaveBeenCalled();
  });

  it("returns a bounded error when Stripe times out", async () => {
    const membershipService = { listMembershipPlans: jest.fn().mockResolvedValue([plan]) };
    (stripe as any).customers.list.mockReset().mockRejectedValue(new Error("Request timed out"));
    const req: any = { headers: { "idempotency-key": "checkout_timeout" }, auth_context: { actor_id: "cus_1" }, validatedBody: { plan_id: plan.id, email: "a@b.test", name: "Ada", metadata }, publishable_key_context: { sales_channel_ids: ["sc_allowed"] }, scope: scopeFor(membershipService) };
    const res = response();
    await POST(req, res);
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Stripe did not respond") }));
  });
});
