import { MiddlewareRoute } from "@medusajs/medusa";
import { adminCompaniesMiddlewares } from "./companies/middlewares";
import { adminQuotesMiddlewares } from "./quotes/middlewares";
import { adminApprovalsMiddlewares } from "./approvals/middlewares";
import { adminMembershipsMiddlewares } from "./membership-plans/middlewares";
import { adminOrganizationSalesTaxMiddlewares } from "./athletify/organization-sales-tax/middlewares";

export const adminMiddlewares: MiddlewareRoute[] = [
  ...adminCompaniesMiddlewares,
  ...adminQuotesMiddlewares,
  ...adminApprovalsMiddlewares,
  ...adminMembershipsMiddlewares,
  ...adminOrganizationSalesTaxMiddlewares,
];
