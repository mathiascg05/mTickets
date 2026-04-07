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
      slug: i.string().unique().indexed(),
      date: i.string(),
      venue: i.string().optional(),
      description: i.string().optional(),
      status: i.string().indexed(),
      scannerPin: i.string().optional(),
      flyerUrl: i.string().optional(),
      logoUrl: i.string().optional(),
      primaryColor: i.string().optional(),
      lastOrderSeq: i.number().optional().indexed(),
      organizerEmail: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    ticketTypes: i.entity({
      name: i.string(),
      price: i.number(),
      quantity: i.number(),
      description: i.string().optional(),
      visibility: i.string().optional(),
      hideAvailability: i.boolean().optional(),
      feePercent: i.number().optional(),
      feeFixed: i.number().optional(),
      lastQueuePosition: i.number().optional().indexed(),
      createdAt: i.number().indexed(),
    }),
    orders: i.entity({
      firstName: i.string(),
      lastName: i.string(),
      email: i.string().indexed(),
      cedula: i.string().indexed(),
      paymentMethod: i.string(),
      promoter: i.string().optional(),
      customFieldValues: i.string().optional(),
      status: i.string().indexed(),
      paymentProofPath: i.string().optional(),
      proofReferenceNumber: i.string().optional(),
      visited: i.boolean().indexed(),
      couponCode: i.string().optional(),
      discountAmount: i.number().optional(),
      phaseId: i.string().optional(),
      orderNumber: i.string().optional().unique().indexed(),
      purchaseGroupId: i.string().optional().indexed(),
      purchaseRate: i.number().optional(),
      purchaseRateCurrency: i.string().optional(),
      purchaseAmountBs: i.number().optional(),
      createdAt: i.number().indexed(),
    }),
    paymentMethods: i.entity({
      type: i.string().indexed(),
      name: i.string(),
      instructions: i.string(),
      convertCurrency: i.string().optional(),
      requireScreenshot: i.boolean().optional(),
      requireReferenceNumber: i.boolean().optional(),
      createdAt: i.number().indexed(),
    }),
    customFields: i.entity({
      label: i.string(),
      fieldType: i.string(),
      required: i.boolean(),
      options: i.string().optional(),
      sortOrder: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    exchangeRates: i.entity({
      currency: i.string().indexed(),
      rate: i.number(),
      fetchedAt: i.number().indexed(),
    }),
    ticketPhases: i.entity({
      name: i.string(),
      price: i.number(),
      quantity: i.number(),
      endDate: i.string().optional().indexed(),
      sortOrder: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    coupons: i.entity({
      code: i.string().unique().indexed(),
      discountType: i.string(),
      discountValue: i.number(),
      maxUses: i.number().optional(),
      active: i.boolean().indexed(),
      createdAt: i.number().indexed(),
    }),
    reservations: i.entity({
      quantity: i.number(),
      expiresAt: i.number().indexed(),
      phaseId: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    queueEntries: i.entity({
      sessionId: i.string().indexed(),
      status: i.string().indexed(),
      position: i.number().indexed(),
      quantity: i.number(),
      admittedAt: i.number().optional().indexed(),
      expiresAt: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    messages: i.entity({
      firstName: i.string(),
      lastName: i.string(),
      email: i.string().indexed(),
      subject: i.string(),
      body: i.string(),
      status: i.string().indexed(),
      adminReply: i.string().optional(),
      repliedAt: i.number().optional().indexed(),
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
    concertCustomFields: {
      forward: {
        on: "customFields",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "customFields",
      },
    },
    ticketTypePhases: {
      forward: {
        on: "ticketPhases",
        has: "one",
        label: "ticketType",
        onDelete: "cascade",
      },
      reverse: {
        on: "ticketTypes",
        has: "many",
        label: "phases",
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
    ticketTypeReservations: {
      forward: {
        on: "reservations",
        has: "one",
        label: "ticketType",
        onDelete: "cascade",
      },
      reverse: {
        on: "ticketTypes",
        has: "many",
        label: "reservations",
      },
    },
    ticketTypeQueueEntries: {
      forward: {
        on: "queueEntries",
        has: "one",
        label: "ticketType",
        onDelete: "cascade",
      },
      reverse: {
        on: "ticketTypes",
        has: "many",
        label: "queueEntries",
      },
    },
    concertMessages: {
      forward: {
        on: "messages",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "messages",
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
