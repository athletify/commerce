import { validateAndTransformBody } from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import { StoreCancelMembership, StoreCreateMembershipCheckout } from "./validators";
import { enrichProductMemberships } from "./product-membership";

export const storeMembershipsMiddlewares: MiddlewareRoute[] = [
  { method: ["POST"], matcher: "/store/memberships/checkout", middlewares: [validateAndTransformBody(StoreCreateMembershipCheckout)] },
  { method: ["POST"], matcher: "/store/memberships/:id/cancel", middlewares: [validateAndTransformBody(StoreCancelMembership)] },
  // Medusa owns these handlers. Wrapping json keeps its standard catalogue API
  // intact while adding the public membership projection.
  { method: ["GET"], matcher: "/store/products*", middlewares: [enrichProductMemberships] },
];
