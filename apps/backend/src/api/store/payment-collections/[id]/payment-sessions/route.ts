import { MedusaResponse, MedusaStoreRequest, refetchEntity } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from "@medusajs/framework/utils";
import { createPaymentSessionsWorkflow } from "@medusajs/medusa/core-flows";
import { StripeConnectConfigurationError, maskConnectedAccount, resolveStripeConnectedAccount } from "../../../../../utils/stripe-connect";
import { resolveLogger } from "../../../../memberships/container";

type ProviderData = Record<string, unknown>;
type StripeConnectPrivateData = {
  athletify_stripe_connected_account_id?: string;
  athletify_stripe_metadata?: Record<string, string>;
};
type CreatePaymentSessionBody = { provider_id: string; data?: ProviderData };
type CartPaymentCollectionRelation = {
  cart?: { id: string; sales_channel_id: string; metadata?: Record<string, unknown> | null };
};

const STRIPE_PROVIDER_ID = "pp_stripe_stripe";
const privateStripeDataKeys: Array<keyof StripeConnectPrivateData> = [
  "athletify_stripe_connected_account_id",
  "athletify_stripe_metadata",
];

const withoutPrivateStripeData = (data: ProviderData): ProviderData => {
  const sanitized = { ...data };
  for (const key of privateStripeDataKeys) delete sanitized[key];
  return sanitized;
};

const metadataForCart = (cart: NonNullable<CartPaymentCollectionRelation["cart"]>): Record<string, string> => {
  const metadata: Record<string, string> = {
    athletify_cart_id: cart.id,
    athletify_sales_channel_id: cart.sales_channel_id,
  };
  const cartMetadata = cart.metadata || {};
  for (const key of ["organization_id", "company_id", "stock_location_id", "sale_source"] as const) {
    const value = cartMetadata[key];
    if (typeof value === "string" && value) metadata[`athletify_${key}`] = value;
  }
  return metadata;
};

export const POST = async (req: MedusaStoreRequest<CreatePaymentSessionBody>, res: MedusaResponse) => {
  const { provider_id, data } = req.body;
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const relations = await remoteQuery(remoteQueryObjectFromString({
    entryPoint: "cart_payment_collection",
    variables: { filters: { payment_collection_id: req.params.id } },
    fields: ["cart.id", "cart.sales_channel_id", "cart.metadata"],
  })) as CartPaymentCollectionRelation[];
  const cart = relations.at(0)?.cart;
  if (!cart) return res.status(404).json({ message: "Payment collection cart not found" });

  const providerData = withoutPrivateStripeData(data || {});
  const logger = resolveLogger(req.scope);
  if (provider_id === STRIPE_PROVIDER_ID) {
    try {
      const serverStripeData: StripeConnectPrivateData = { athletify_stripe_metadata: metadataForCart(cart) };
      const destination = await resolveStripeConnectedAccount(req.scope, cart.sales_channel_id);
      if (destination) {
        serverStripeData.athletify_stripe_connected_account_id = destination;
        logger.info(`Stripe destination charge initialized sales_channel_id=${cart.sales_channel_id} destination=${maskConnectedAccount(destination)}`);
      } else {
        logger.info(`Stripe platform charge initialized sales_channel_id=${cart.sales_channel_id}`);
      }
      Object.assign(providerData, serverStripeData);
    } catch (error: unknown) {
      const message = error instanceof StripeConnectConfigurationError ? error.message : "Unable to configure Stripe destination";
      logger.warn(`Stripe destination charge rejected sales_channel_id=${cart.sales_channel_id} reason=${message}`);
      return res.status(422).json({ message });
    }
  }

  await createPaymentSessionsWorkflow(req.scope).run({
    input: {
      payment_collection_id: req.params.id,
      provider_id,
      customer_id: req.auth_context?.actor_id,
      data: providerData,
    },
  });
  const paymentCollection = await refetchEntity({
    entity: "payment_collection",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: req.queryConfig.fields.length ? req.queryConfig.fields : ["id", "currency_code", "amount", "*payment_sessions"],
  });
  res.status(200).json({ payment_collection: paymentCollection });
};
