export type OrderPricing = {
  status: string;
  phaseId?: string;
  discountAmount?: number;
  paymentMethodDiscount?: number;
  priceSnapshot?: number;
  feePercentSnapshot?: number;
  feeFixedSnapshot?: number;
  feeAmountSnapshot?: number;
  totalSnapshot?: number;
  paymentMethodFeePercentSnapshot?: number;
  paymentMethodFeeFixedSnapshot?: number;
  paymentMethodFeeAmountSnapshot?: number;
};

export type TicketTypePricing = {
  price: number;
  feePercent?: number;
  feeFixed?: number;
  phases?: { id: string; price: number }[];
};

function recomputeBase(order: OrderPricing, tt: TicketTypePricing): number {
  const phase = (tt.phases || []).find((p) => p.id === order.phaseId);
  return phase ? phase.price : tt.price;
}

function recomputeFee(base: number, tt: TicketTypePricing): number {
  return (base * (tt.feePercent ?? 0)) / 100 + (tt.feeFixed ?? 0);
}

export function getOrderTotal(
  order: OrderPricing,
  tt?: TicketTypePricing | null,
): number {
  if (typeof order.totalSnapshot === "number") return order.totalSnapshot;
  if (!tt) return 0;
  const base = recomputeBase(order, tt);
  const fee = recomputeFee(base, tt);
  const pmFee = order.paymentMethodFeeAmountSnapshot ?? 0;
  const total =
    base +
    fee +
    pmFee -
    (order.discountAmount ?? 0) -
    (order.paymentMethodDiscount ?? 0);
  return Math.max(0, total);
}

export function getOrderBaseDisplayPrice(
  order: OrderPricing,
  tt?: TicketTypePricing | null,
): number {
  if (
    typeof order.priceSnapshot === "number" &&
    typeof order.feeAmountSnapshot === "number"
  ) {
    return (
      order.priceSnapshot +
      order.feeAmountSnapshot +
      (order.paymentMethodFeeAmountSnapshot ?? 0)
    );
  }
  if (!tt) return 0;
  const base = recomputeBase(order, tt);
  return base + recomputeFee(base, tt);
}

export function computeOrderTotalAtPurchase(args: {
  basePrice: number;
  feePercent: number;
  feeFixed: number;
  paymentMethodFeePercent?: number;
  paymentMethodFeeFixed?: number;
  couponDiscount: number;
  paymentMethodDiscount: number;
}): {
  feeAmount: number;
  paymentMethodFeeAmount: number;
  total: number;
} {
  const feeAmount = (args.basePrice * args.feePercent) / 100 + args.feeFixed;
  const paymentMethodFeeAmount =
    (args.basePrice * (args.paymentMethodFeePercent ?? 0)) / 100 +
    (args.paymentMethodFeeFixed ?? 0);
  const total = Math.max(
    0,
    args.basePrice +
      feeAmount +
      paymentMethodFeeAmount -
      args.couponDiscount -
      args.paymentMethodDiscount,
  );
  return { feeAmount, paymentMethodFeeAmount, total };
}

/**
 * Platform fee charged to the organizer for one order.
 *
 * `extrasBase` is the extras subtotal of the checkout, and it only ever feeds
 * the PERCENTAGE part: the fixed fee stays per ticket, so buying a t-shirt does
 * not add a second fixed charge. It is passed only on the anchor order of a
 * checkout (the one that carries the extras money), so the sum of the group's
 * platformFeeAmountSnapshot equals the fee over tickets + extras exactly once.
 * Omitting it reproduces the previous behaviour byte for byte.
 */
export function computePlatformFeeAtPurchase(args: {
  basePrice: number;
  feePercent: number;
  feeFixed: number;
  extrasBase?: number;
}): number {
  const base = args.basePrice + (args.extrasBase ?? 0);
  const fee = (base * args.feePercent) / 100 + args.feeFixed;
  return Math.round(fee * 100) / 100;
}

export type PlatformFeeOrderShape = {
  platformFeeAmountSnapshot?: number;
  priceSnapshot?: number;
  phaseId?: string;
};

export function getPlatformFeeForOrder(
  order: PlatformFeeOrderShape,
  ticketType: TicketTypePricing | null | undefined,
  config: { feePercent: number; feeFixed: number } | null | undefined,
): number {
  if (typeof order.platformFeeAmountSnapshot === "number") {
    return Math.round(order.platformFeeAmountSnapshot * 100) / 100;
  }
  if (!config) return 0;
  let basePrice = order.priceSnapshot;
  if (basePrice === undefined) {
    if (!ticketType) return 0;
    const phase = (ticketType.phases || []).find((p) => p.id === order.phaseId);
    basePrice = phase ? phase.price : ticketType.price;
  }
  return computePlatformFeeAtPurchase({
    basePrice,
    feePercent: config.feePercent,
    feeFixed: config.feeFixed,
  });
}

export function getEventRevenue(
  concert: {
    ticketTypes: (TicketTypePricing & { orders: OrderPricing[] })[];
  },
  statusFilter: (status: string) => boolean = (s) => s === "approved",
): number {
  let sum = 0;
  for (const tt of concert.ticketTypes) {
    for (const order of tt.orders) {
      if (!statusFilter(order.status)) continue;
      sum += getOrderTotal(order, tt);
    }
  }
  return sum;
}
