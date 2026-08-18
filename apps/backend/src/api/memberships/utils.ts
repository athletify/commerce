import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { RemoteQueryFunction } from "@medusajs/framework/types";

export type VariantPrice = { amount: number; currency_code: string };

export const storeSalesChannelIds = (req: any): string[] => {
  const context = req.publishable_key_context || req.publishableKeyContext;
  return context?.sales_channel_ids || context?.salesChannels?.map((c: any) => c.id) || [];
};

export async function getVariantForMembership(
  scope: any,
  productId: string,
  variantId: string,
  salesChannelId: string
): Promise<{ title: string; price: VariantPrice }> {
  const query: RemoteQueryFunction = scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: [product] } = await query.graph({
    entity: "product",
    fields: ["id", "title", "sales_channels.id", "variants.id", "variants.prices.*"],
    filters: { id: productId },
  });

  if (!product || !product.sales_channels?.some((channel: any) => channel.id === salesChannelId)) {
    throw new Error("Product does not belong to the configured sales channel");
  }
  const variant = product.variants?.find((item: any) => item.id === variantId);
  if (!variant) {
    throw new Error("Variant does not belong to the product");
  }
  // A recurring plan needs one deterministic price. Region/rule prices are not
  // representable by a single Stripe recurring Price in this first phase.
  const price = (variant as any).prices?.find((item: any) =>
    !item.price_rules?.length && item.currency_code && item.amount !== undefined
  );
  if (!price) {
    throw new Error("Variant must have a currency price without price rules");
  }
  return { title: product.title, price: { amount: Number(price.amount), currency_code: price.currency_code } };
}

export const publicPlan = (plan: any) => ({
  plan_id: plan.id,
  billing_period: plan.billing_period,
  amount: Number(plan.amount),
  currency_code: plan.currency_code,
});
