import StripeProviderService from "@medusajs/payment-stripe/dist/services/stripe-provider";
import type { InitiatePaymentInput, InitiatePaymentOutput, RefundPaymentInput, RefundPaymentOutput } from "@medusajs/framework/types";
import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import { getSmallestUnit } from "@medusajs/payment-stripe/dist/utils/get-smallest-unit";
import { maskConnectedAccount } from "../utils/stripe-connect";

type StripeIntentParameters = {
  metadata?: Record<string, string>;
  transfer_data?: { destination: string };
};

type StripeConnectPaymentData = Record<string, unknown> & {
  session_id?: string;
  athletify_stripe_connected_account_id?: string;
  athletify_stripe_metadata?: Record<string, unknown>;
};

/**
 * StripeBase adds `session_id` to the PaymentIntent metadata. Its optional
 * parameters are spread afterwards, so a custom metadata object must preserve
 * that value or the standard webhook subscriber cannot find the session.
 */
export const withStripeConnectMetadata = (
  parameters: StripeIntentParameters,
  extra?: StripeConnectPaymentData
): StripeIntentParameters => {
  const metadata = extra?.athletify_stripe_metadata;
  const sessionId = extra?.session_id;
  const connectMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? Object.fromEntries(Object.entries(metadata).filter(([, value]) => typeof value === "string")) as Record<string, string>
    : {};

  if (!Object.keys(connectMetadata).length && typeof sessionId !== "string") {
    return parameters;
  }

  return {
    ...parameters,
    metadata: {
      ...parameters.metadata,
      ...connectMetadata,
      ...(typeof sessionId === "string" ? { session_id: sessionId } : {}),
    },
  };
};

/**
 * keeps Medusa's pp_stripe_stripe contract while adding a destination resolved
 * by our server-side payment-session route.
 */
const stripeErrorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

export class StripeConnectProviderService extends StripeProviderService {
  override normalizePaymentIntentParameters(extra?: Record<string, unknown>) {
    let parameters = withStripeConnectMetadata(
      super.normalizePaymentIntentParameters(extra) as StripeIntentParameters,
      extra as StripeConnectPaymentData | undefined
    );
    const destination = extra?.athletify_stripe_connected_account_id;
    if (typeof destination === "string") {
      parameters.transfer_data = { destination };
    }
    return parameters;
  }

  override async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const payment = await super.initiatePayment(input);
    const destination = input.data?.athletify_stripe_connected_account_id;
    if (typeof destination === "string") {
      const logger = this.container_.logger as { info?: (message: string) => void } | undefined;
      logger?.info?.(
        `Stripe destination PaymentIntent initialized destination=${maskConnectedAccount(destination)} payment_intent_id=${payment.id}`
      );
    }
    return payment;
  }

  /**
   * A destination charge is charged on the platform, but its funds are
   * transferred to the connected account. Stripe does not reverse that
   * transfer by default on a refund, which would make the platform absorb the
   * cost. Read the PaymentIntent from Stripe (the source of truth) and reverse
   * its transfer whenever it has a destination.
   */
  override async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const id = input.data?.id;
    const currency = input.data?.currency;
    if (typeof id !== "string" || typeof currency !== "string") {
      return super.refundPayment(input);
    }

    const paymentIntent = await this.stripe_.paymentIntents.retrieve(id);
    if (!paymentIntent.transfer_data?.destination) {
      return super.refundPayment(input);
    }

    try {
      const refund = {
        payment_intent: id,
        reverse_transfer: true,
        ...(input.amount === undefined ? {} : { amount: getSmallestUnit(input.amount, currency) }),
      };
      await this.stripe_.refunds.create(refund, {
        idempotencyKey: input.context?.idempotency_key,
      });
    } catch (error: unknown) {
      if (stripeErrorCode(error) !== "charge_already_refunded") {
        throw this.buildError(
          "An error occurred in refundPayment for a Stripe destination charge",
          error instanceof Error ? error : new Error("Unknown Stripe refund error")
        );
      }
    }

    return { data: input.data };
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [StripeConnectProviderService],
});
