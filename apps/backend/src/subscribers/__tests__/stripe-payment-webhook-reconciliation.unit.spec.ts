jest.mock("@medusajs/medusa/core-flows", () => ({
  processPaymentWorkflowId: "process-payment-workflow",
}));

import { Modules, PaymentActions } from "@medusajs/framework/utils";
import reconcileStripePaymentWebhook from "../stripe-payment-webhook-reconciliation";

describe("Stripe payment webhook reconciliation", () => {
  it("finds a legacy Stripe session by data.id and sends it through Medusa's authorization workflow", async () => {
    const paymentService = {
      getWebhookActionAndData: jest.fn().mockResolvedValue({
        action: PaymentActions.SUCCESSFUL,
        data: { amount: 11 },
      }),
      listPaymentSessions: jest.fn().mockResolvedValue([{ id: "payses_1" }]),
    };
    const workflowEngine = { run: jest.fn().mockResolvedValue(undefined) };
    const logger = { warn: jest.fn() };
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === Modules.PAYMENT) return paymentService;
        if (key === Modules.WORKFLOW_ENGINE) return workflowEngine;
        return logger;
      }),
    };
    const event = {
      provider: "stripe_stripe",
      payload: {
        data: {
          object: { id: "pi_3U1BOjFGYalzBkR90KOm5ktN" },
        },
      },
    };

    await reconcileStripePaymentWebhook({ event: { data: event }, container } as never);

    expect(paymentService.listPaymentSessions).toHaveBeenCalledWith({
      data: { id: "pi_3U1BOjFGYalzBkR90KOm5ktN" },
    });
    expect(workflowEngine.run).toHaveBeenCalledWith("process-payment-workflow", {
      input: {
        action: PaymentActions.SUCCESSFUL,
        data: { amount: 11, session_id: "payses_1" },
      },
    });
  });

  it("leaves events that already contain session_id to the standard subscriber", async () => {
    const paymentService = {
      getWebhookActionAndData: jest.fn().mockResolvedValue({
        action: PaymentActions.SUCCESSFUL,
        data: { amount: 11, session_id: "payses_1" },
      }),
      listPaymentSessions: jest.fn(),
    };
    const workflowEngine = { run: jest.fn() };
    const container = {
      resolve: jest.fn((key: string) => key === Modules.PAYMENT ? paymentService : workflowEngine),
    };

    await reconcileStripePaymentWebhook({
      event: { data: { provider: "stripe_stripe", payload: { data: { object: { id: "pi_1" } } } } },
      container,
    } as never);

    expect(paymentService.listPaymentSessions).not.toHaveBeenCalled();
    expect(workflowEngine.run).not.toHaveBeenCalled();
  });
});
