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
      acceptedTermsVersion: i.string().optional(),
      acceptedTermsAt: i.number().optional(),
      acceptedOrganizerTermsVersion: i.string().optional(),
      acceptedOrganizerTermsAt: i.number().optional(),
      acceptedPrivacyVersion: i.string().optional(),
      acceptedPrivacyAt: i.number().optional(),
    }),
    concerts: i.entity({
      name: i.string(),
      slug: i.string().unique().indexed(),
      date: i.string(),
      venue: i.string().optional(),
      venueMapUrl: i.string().optional(),
      description: i.string().optional(),
      status: i.string().indexed(),
      scannerPin: i.string().optional(),
      flyerUrl: i.string().optional(),
      logoUrl: i.string().optional(),
      primaryColor: i.string().optional(),
      lastOrderSeq: i.number().optional().indexed(),
      organizerEmail: i.string().indexed(),
      defaultLanguage: i.string().optional(),
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
      acceptedTermsVersion: i.string().optional(),
      acceptedPrivacyVersion: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    paymentMethods: i.entity({
      type: i.string().indexed(),
      name: i.string(),
      instructions: i.string().optional(),
      convertCurrency: i.string().optional(),
      requireScreenshot: i.boolean().optional(),
      requireReferenceNumber: i.boolean().optional(),
      showConversionDetail: i.boolean().optional(),
      zelleEmail: i.string().optional(),
      zelleName: i.string().optional(),
      pmCedula: i.string().optional(),
      pmPhone: i.string().optional(),
      pmBank: i.string().optional(),
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
    organizerBalances: i.entity({
      email: i.string().unique().indexed(),
      balance: i.number(),
      currency: i.string(),
      updatedAt: i.number().indexed(),
    }),
    balanceTransactions: i.entity({
      type: i.string().indexed(),
      amount: i.number(),
      balanceBefore: i.number(),
      balanceAfter: i.number(),
      description: i.string(),
      orderId: i.string().optional().indexed(),
      concertId: i.string().optional().indexed(),
      createdAt: i.number().indexed(),
    }),
    platformFeeConfigs: i.entity({
      feePercent: i.number(),
      feeFixed: i.number(),
      billingMode: i.string().indexed(),
      updatedAt: i.number().indexed(),
    }),
    emailSuppressions: i.entity({
      email: i.string().unique().indexed(),
      reason: i.string().indexed(),
      source: i.string(),
      detail: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    credentials: i.entity({
      passwordHash: i.string(),
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
    balanceTransactionBalance: {
      forward: {
        on: "balanceTransactions",
        has: "one",
        label: "organizerBalance",
      },
      reverse: {
        on: "organizerBalances",
        has: "many",
        label: "transactions",
      },
    },
    concertPlatformFee: {
      forward: {
        on: "platformFeeConfigs",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "one",
        label: "platformFeeConfig",
      },
    },
    userCredentials: {
      forward: {
        on: "credentials",
        has: "one",
        label: "user",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "one",
        label: "credentials",
      },
    },
  },
  rooms: {
    eventPage: {
      presence: i.entity({
        joinedAt: i.number(),
      }),
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
