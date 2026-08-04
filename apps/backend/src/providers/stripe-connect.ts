import StripeProviderService from "@medusajs/payment-stripe/dist/services/stripe-provider";
import type { InitiatePaymentInput, InitiatePaymentOutput } from "@medusajs/framework/types";
import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import { maskConnectedAccount } from "../utils/stripe-connect";

/**
 * keeps Medusa's pp_stripe_stripe contract while adding a destination resolved
 * by our server-side payment-session route.
 */
class StripeConnectProviderService extends StripeProviderService {
  override normalizePaymentIntentParameters(extra?: Record<string, unknown>) {
    const parameters: any = super.normalizePaymentIntentParameters(extra);
    const destination = extra?.athletify_stripe_connected_account_id;
    const metadata = extra?.athletify_stripe_metadata;
    if (typeof destination === "string") {
      parameters.transfer_data = { destination };
    }
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      parameters.metadata = {
        ...(parameters.metadata || {}),
        ...Object.fromEntries(
          Object.entries(metadata).filter(([, value]) => typeof value === "string")
        ),
      };
    }
    return parameters;
  }

  override async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const payment = await super.initiatePayment(input);
    const destination = input.data?.athletify_stripe_connected_account_id;
    if (typeof destination === "string") {
      (this.container_.logger as any)?.info?.(
        `Stripe destination PaymentIntent initialized destination=${maskConnectedAccount(destination)} payment_intent_id=${payment.id}`
      );
    }
    return payment;
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [StripeConnectProviderService],
});
