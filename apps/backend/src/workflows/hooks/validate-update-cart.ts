import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { updateCartWorkflow } from "@medusajs/medusa/core-flows";
import { getCartApprovalStatus } from "../../utils/get-cart-approval-status";
import { applyStockLocationTaxes } from "../../utils/stock-location-tax";

updateCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const {
    data: [queryCart],
  } = await query.graph({
    entity: "cart",
    fields: ["approvals.*"],
    filters: {
      id: cart.id,
    },
  });

  const { isPendingApproval } = getCartApprovalStatus(queryCart);

  if (isPendingApproval) {
    throw new Error("Cart is pending approval");
  }

  return new StepResponse(undefined, null);
});

updateCartWorkflow.hooks.cartUpdated(async ({ cart }, { container }) => {
  await applyStockLocationTaxes(container, cart.id);
  return new StepResponse(undefined, null);
});
