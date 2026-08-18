import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { addToCartWorkflow } from "@medusajs/medusa/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { StoreAddLineItemsBulkType } from "../../../validators";
import { applyStockLocationTaxes } from "../../../../../../utils/stock-location-tax";

export async function POST(
  req: MedusaRequest<StoreAddLineItemsBulkType>,
  res: MedusaResponse
) {
  const { id } = req.params;
  const { line_items } = req.validatedBody;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const {
    data: [cart],
  } = await query.graph(
    {
      entity: "cart",
      fields: req.queryConfig.fields,
      filters: { id },
    },
    { throwIfKeyNotFound: true }
  );

  const workflowInput = {
    cart_id: cart.id,
    items: line_items,
  };

  await addToCartWorkflow(req.scope).run({
    input: workflowInput,
  });

  await applyStockLocationTaxes(req.scope, cart.id);

  const {
    data: [upatedCart],
  } = await query.graph(
    {
      entity: "cart",
      fields: req.queryConfig.fields,
      filters: { id },
    },
    { throwIfKeyNotFound: true }
  );

  res.json({ cart: upatedCart });
}
