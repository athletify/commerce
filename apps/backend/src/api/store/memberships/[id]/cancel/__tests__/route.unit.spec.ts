jest.mock("../../../../../../modules/membership/stripe", () => ({
  stripe: { subscriptions: { update: jest.fn(), cancel: jest.fn() } },
  membershipStatus: (status: string) => status,
  stripeDate: () => null,
}));

import { POST } from "../route";
import { stripe } from "../../../../../../modules/membership/stripe";

const response = () => {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe("membership cancellation", () => {
  it("rejects cancellation for a one-time membership before calling Stripe", async () => {
    const membership = { id: "msub_1", renewal_type: "none", status: "active", plan: { sales_channel_id: "sc_1" } };
    const service = { listMembershipSubscriptions: jest.fn().mockResolvedValue([membership]) };
    const req: any = { params: { id: "msub_1" }, validatedBody: { reason: "No longer needed", immediately: false }, publishable_key_context: { sales_channel_ids: ["sc_1"] }, scope: { resolve: () => service } };
    const res: any = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    await POST(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: "One-time memberships cannot be canceled" });
  });

  const membership = {
    id: "msub_1", status: "active", stripe_subscription_id: "sub_1",
    plan: { sales_channel_id: "sc_1" },
  };

  it("cancels at period end and persists the required reason", async () => {
    const service = {
      listMembershipSubscriptions: jest.fn().mockResolvedValue([membership]),
      updateMembershipSubscriptions: jest.fn().mockImplementation(async (data) => ({ ...membership, ...data })),
    };
    (stripe as any).subscriptions.update.mockResolvedValue({
      status: "active", cancel_at_period_end: true, current_period_start: 0, current_period_end: 0,
    });
    const req: any = {
      params: { id: "msub_1" },
      validatedBody: { reason: "No longer needed", immediately: false },
      publishable_key_context: { sales_channel_ids: ["sc_1"] },
      scope: { resolve: () => service },
    };
    const res = response();

    await POST(req, res);

    expect((stripe as any).subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
      metadata: { cancellation_reason: "No longer needed" },
    });
    expect(service.updateMembershipSubscriptions).toHaveBeenCalledWith(expect.objectContaining({
      id: "msub_1",
      cancellation_reason: "No longer needed",
      cancellation_requested_at: expect.any(Date),
      cancel_at_period_end: true,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      membership_subscription: expect.objectContaining({ cancellation_reason: "No longer needed", cancel_at_period_end: true }),
    }));
  });

  it("can cancel immediately while preserving the cancellation reason", async () => {
    const service = {
      listMembershipSubscriptions: jest.fn().mockResolvedValue([membership]),
      updateMembershipSubscriptions: jest.fn().mockImplementation(async (data) => ({ ...membership, ...data })),
    };
    (stripe as any).subscriptions.update.mockResolvedValue({});
    (stripe as any).subscriptions.cancel.mockResolvedValue({
      status: "canceled", cancel_at_period_end: false, current_period_start: 0, current_period_end: 0,
    });
    const req: any = {
      params: { id: "msub_1" },
      validatedBody: { reason: "Requested a refund", immediately: true },
      publishable_key_context: { sales_channel_ids: ["sc_1"] },
      scope: { resolve: () => service },
    };

    await POST(req, response());

    expect((stripe as any).subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(service.updateMembershipSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled", cancellation_reason: "Requested a refund" }));
  });
});
