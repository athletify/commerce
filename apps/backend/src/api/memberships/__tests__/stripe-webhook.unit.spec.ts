import { verifyStripeWebhook } from "../stripe-webhook";

describe("verifyStripeWebhook", () => {
  const stripe: any = { webhooks: { constructEvent: jest.fn() } };

  beforeEach(() => jest.clearAllMocks());

  it("requires a signature, signing secret, and preserved raw body", () => {
    expect(verifyStripeWebhook({ headers: { "stripe-signature": "sig" }, rawBody: Buffer.from("{}") } as any, stripe, undefined))
      .toEqual({ valid: false, message: "Membership Stripe webhook secret is not configured" });
    expect(verifyStripeWebhook({ headers: {}, rawBody: Buffer.from("{}") } as any, stripe, "whsec_test"))
      .toEqual({ valid: false, message: "Missing Stripe signature" });
    expect(verifyStripeWebhook({ headers: { "stripe-signature": "sig" } } as any, stripe, "whsec_test"))
      .toEqual({ valid: false, message: "Missing Stripe signature" });
  });

  it("returns a verified Stripe event and maps invalid signatures to 400-safe output", () => {
    const request: any = { headers: { "stripe-signature": "sig" }, rawBody: Buffer.from("{}") };
    const event = { id: "evt_1" };
    stripe.webhooks.constructEvent.mockReturnValue(event);
    expect(verifyStripeWebhook(request, stripe, "whsec_test")).toEqual({ valid: true, event });
    stripe.webhooks.constructEvent.mockImplementation(() => { throw new Error("bad signature"); });
    expect(verifyStripeWebhook(request, stripe, "whsec_test"))
      .toEqual({ valid: false, message: "Invalid Stripe signature" });
  });
});
