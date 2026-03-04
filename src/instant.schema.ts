import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
    }),
    concerts: i.entity({
      name: i.string(),
      date: i.string(),
      venue: i.string(),
      description: i.string(),
      status: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    ticketTypes: i.entity({
      name: i.string(),
      price: i.number(),
      quantity: i.number(),
      description: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    orders: i.entity({
      firstName: i.string(),
      lastName: i.string(),
      email: i.string().indexed(),
      cedula: i.string().indexed(),
      paymentMethod: i.string(),
      promoter: i.string().optional(),
      status: i.string().indexed(),
      paymentProofPath: i.string(),
      visited: i.boolean().indexed(),
      couponCode: i.string().optional(),
      discountAmount: i.number().optional(),
      createdAt: i.number().indexed(),
    }),
    paymentMethods: i.entity({
      name: i.string(),
      instructions: i.string(),
      convertCurrency: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    promoters: i.entity({
      name: i.string(),
      createdAt: i.number().indexed(),
    }),
    exchangeRates: i.entity({
      currency: i.string().indexed(),
      rate: i.number(),
      fetchedAt: i.number().indexed(),
    }),
    coupons: i.entity({
      code: i.string().unique().indexed(),
      discountType: i.string(),
      discountValue: i.number(),
      maxUses: i.number().optional(),
      active: i.boolean().indexed(),
      createdAt: i.number().indexed(),
    }),
  },
  links: {
    concertTicketTypes: {
      forward: {
        on: "ticketTypes",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "ticketTypes",
      },
    },
    ticketTypeOrders: {
      forward: {
        on: "orders",
        has: "one",
        label: "ticketType",
        onDelete: "cascade",
      },
      reverse: {
        on: "ticketTypes",
        has: "many",
        label: "orders",
      },
    },
    concertPaymentMethods: {
      forward: {
        on: "paymentMethods",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "paymentMethods",
      },
    },
    concertPromoters: {
      forward: {
        on: "promoters",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "promoters",
      },
    },
    concertCoupons: {
      forward: {
        on: "coupons",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "coupons",
      },
    },
  },
  rooms: {},
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
