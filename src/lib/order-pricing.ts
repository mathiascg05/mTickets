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
  const total =
    base + fee - (order.discountAmount ?? 0) - (order.paymentMethodDiscount ?? 0);
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
    return order.priceSnapshot + order.feeAmountSnapshot;
  }
  if (!tt) return 0;
  const base = recomputeBase(order, tt);
  return base + recomputeFee(base, tt);
}

export function computeOrderTotalAtPurchase(args: {
  basePrice: number;
  feePercent: number;
  feeFixed: number;
  couponDiscount: number;
  paymentMethodDiscount: number;
}): {
  feeAmount: number;
  total: number;
} {
  const feeAmount = (args.basePrice * args.feePercent) / 100 + args.feeFixed;
  const total = Math.max(
    0,
    args.basePrice + feeAmount - args.couponDiscount - args.paymentMethodDiscount,
  );
  return { feeAmount, total };
}

export function computePlatformFeeAtPurchase(args: {
  basePrice: number;
  feePercent: number;
  feeFixed: number;
}): number {
  const fee = (args.basePrice * args.feePercent) / 100 + args.feeFixed;
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
