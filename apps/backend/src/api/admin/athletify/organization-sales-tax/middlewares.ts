import { validateAndTransformBody } from "@medusajs/framework";
import { MiddlewareRoute } from "@medusajs/medusa";
import { AdminOrganizationSalesTax } from "./validators";

export const adminOrganizationSalesTaxMiddlewares: MiddlewareRoute[] = [
  { method: ["POST"], matcher: "/admin/athletify/organization-sales-tax", middlewares: [validateAndTransformBody(AdminOrganizationSalesTax)] },
];
