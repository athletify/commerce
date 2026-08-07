import { StripeConnectProviderService, withStripeConnectMetadata } from "../stripe-connect";

describe("Stripe Connect PaymentIntent parameters", () => {
  it("preserves Medusa's session_id while adding Connect metadata", () => {
    expect(withStripeConnectMetadata(
      { metadata: { existing: "value" } },
      {
        session_id: "payses_1",
        athletify_stripe_metadata: { athletify_cart_id: "cart_1", ignored: 10 },
      }
    )).toEqual({
      metadata: {
        existing: "value",
        athletify_cart_id: "cart_1",
        session_id: "payses_1",
      },
    });
  });

  it("reverses the connected-account transfer when refunding a destination charge", async () => {
    const provider = Object.create(StripeConnectProviderService.prototype) as any;
    provider.stripe_ = {
      paymentIntents: { retrieve: jest.fn().mockResolvedValue({ transfer_data: { destination: "acct_connected" } }) },
      refunds: { create: jest.fn().mockResolvedValue({ id: "re_1" }) },
    };

    await provider.refundPayment({
      amount: 21.3,
      data: { id: "pi_destination", currency: "usd" },
      context: { idempotency_key: "refund-payment_1" },
    });

    expect(provider.stripe_.refunds.create).toHaveBeenCalledWith({
      payment_intent: "pi_destination",
      amount: 2130,
      reverse_transfer: true,
    }, {
      idempotencyKey: "refund-payment_1",
    });
  });
});
