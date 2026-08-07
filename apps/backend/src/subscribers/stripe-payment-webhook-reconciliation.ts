import { ContainerRegistrationKeys, Modules, PaymentActions } from "@medusajs/framework/utils";
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { processPaymentWorkflowId } from "@medusajs/medusa/core-flows";

type StripePaymentIntent = {
  id?: string;
};

type StripeWebhookPayload = {
  data?: {
    object?: StripePaymentIntent;
  };
};

type PaymentWebhookEvent = {
  provider?: string;
  payload?: StripeWebhookPayload;
};

type WebhookAction = {
  action: string;
  data?: {
    session_id?: string;
    amount?: number;
  };
};

type PaymentSession = { id: string };

const STRIPE_PROVIDER = "stripe_stripe";

/**
 * Repairs PaymentIntents created before the Connect provider preserved
 * `metadata.session_id`. The core Medusa subscriber deliberately ignores
 * webhook events without that value. For that legacy shape, data.id is the
 * persisted PaymentIntent identifier and is a deterministic session key.
 */
export default async function reconcileStripePaymentWebhook({
  event: { data: eventData },
  container,
}: SubscriberArgs<PaymentWebhookEvent>) {
  if (eventData.provider !== STRIPE_PROVIDER) return;

  const paymentService = container.resolve(Modules.PAYMENT) as {
    getWebhookActionAndData(event: PaymentWebhookEvent): Promise<WebhookAction>;
    listPaymentSessions(filters: { data: { id: string } }): Promise<PaymentSession[]>;
  };
  const processed = await paymentService.getWebhookActionAndData(eventData);

  // New PaymentIntents carry session_id and are handled by Medusa's standard
  // subscriber. Reprocessing them here would duplicate side effects.
  if (processed.data?.session_id || processed.action !== PaymentActions.SUCCESSFUL) return;

  const paymentIntentId = eventData.payload?.data?.object?.id;
  if (!paymentIntentId) return;

  const sessions = await paymentService.listPaymentSessions({ data: { id: paymentIntentId } });
  if (sessions.length !== 1) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as { warn(message: string): void };
    logger.warn(
      `Stripe webhook reconciliation skipped payment_intent_id=${paymentIntentId} matching_sessions=${sessions.length}`
    );
    return;
  }

  const workflowEngine = container.resolve(Modules.WORKFLOW_ENGINE) as {
    run(workflowId: string, options: { input: WebhookAction }): Promise<unknown>;
  };
  await workflowEngine.run(processPaymentWorkflowId, {
    input: {
      ...processed,
      data: {
        ...processed.data,
        session_id: sessions[0].id,
      },
    },
  });
}

export const config: SubscriberConfig = { event: "payment.webhook_received" };
