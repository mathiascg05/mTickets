import type { InstantRules } from "@instantdb/react";

const SUPER_ADMIN = "matickets.ve@gmail.com";

const rules = {
  concerts: {
    allow: {
      view: "true",
      create: "auth.email != null",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email == data.organizerEmail",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      scannerPin: "isOwner || isSuperAdmin",
    },
  },
  ticketTypes: {
    allow: {
      view: "true",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  orders: {
    allow: {
      view: "true",
      create: "false",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('ticketType.concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      paymentProofPath: "isOwner || isSuperAdmin",
      proofReferenceNumber: "isOwner || isSuperAdmin",
      cedula: "isOwner || isSuperAdmin",
    },
  },
  paymentMethods: {
    allow: {
      view: "true",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  customFields: {
    allow: {
      view: "true",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  ticketPhases: {
    allow: {
      view: "true",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('ticketType.concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  coupons: {
    allow: {
      view: "true",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  reservations: {
    allow: {
      view: "true",
      create: "false",
      update: "isOwner || isSuperAdmin",
      delete: "false",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('ticketType.concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  queueEntries: {
    allow: {
      view: "true",
      create: "false",
      update: "isOwner || isSuperAdmin",
      delete: "false",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('ticketType.concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  exchangeRates: {
    allow: {
      view: "true",
      create: "isSuperAdmin",
      update: "isSuperAdmin",
      delete: "isSuperAdmin",
    },
    bind: ["isSuperAdmin", `auth.email == '${SUPER_ADMIN}'`],
  },
  messages: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "false",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  organizerBalances: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "isSuperAdmin",
      update: "isSuperAdmin",
      delete: "isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email == data.email",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  balanceTransactions: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "isSuperAdmin",
      update: "false",
      delete: "false",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('organizerBalance.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  platformFeeConfigs: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "isSuperAdmin",
      update: "isSuperAdmin",
      delete: "isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  $files: {
    allow: {
      view: `auth.email == '${SUPER_ADMIN}'`,
      create:
        "data.path.startsWith('payment-proofs/') || data.path.startsWith('event-assets/')",
    },
  },
} satisfies InstantRules;

export default rules;
