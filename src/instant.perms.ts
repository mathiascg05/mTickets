import type { InstantRules } from "@instantdb/react";

const SUPER_ADMIN = "matickets.ve@gmail.com";

const rules = {
  concerts: {
    allow: {
      view: "true",
      create: "auth.email != null",
      update: "isOwner || isSuperAdmin",
      delete: "isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email == data.organizerEmail || auth.email in data.ref('collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      scannerPin: "isOwner || isSuperAdmin",
    },
  },
  ticketTypes: {
    allow: {
      view: "data.ref('concert.status') == ['active'] || isOwner || isSuperAdmin",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
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
      "auth.email in data.ref('ticketType.concert.organizerEmail') || auth.email in data.ref('ticketType.concert.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      paymentProofPath: "isOwner || isSuperAdmin",
      proofReferenceNumber: "isOwner || isSuperAdmin",
    },
  },
  paymentMethods: {
    allow: {
      view: "data.ref('concert.status') == ['active'] || isOwner || isSuperAdmin",
      create: "isOwner || isSuperAdmin",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
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
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
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
      "auth.email in data.ref('ticketType.concert.organizerEmail') || auth.email in data.ref('ticketType.concert.collaborators.email')",
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
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
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
      "auth.email in data.ref('ticketType.concert.organizerEmail') || auth.email in data.ref('ticketType.concert.collaborators.email')",
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
      "auth.email in data.ref('ticketType.concert.organizerEmail') || auth.email in data.ref('ticketType.concert.collaborators.email')",
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
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
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
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  credentials: {
    allow: {
      view: "false",
      create: "false",
      update: "false",
      delete: "false",
    },
    bind: [],
  },
  eventCollaborators: {
    allow: {
      view: "isOwner || isCollaborator || isSuperAdmin",
      create: "isOwner || isSuperAdmin",
      update: "false",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail')",
      "isCollaborator",
      "auth.email in data.ref('concert.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  emailSuppressions: {
    allow: {
      view: `auth.email == '${SUPER_ADMIN}'`,
      create: "false",
      update: "false",
      delete: `auth.email == '${SUPER_ADMIN}'`,
    },
    bind: [],
  },
  $files: {
    allow: {
      view: `data.path.startsWith('event-assets/') || auth.email == '${SUPER_ADMIN}'`,
      create:
        "data.path.startsWith('payment-proofs/') || (auth.email != null && data.path.startsWith('event-assets/'))",
    },
  },
} satisfies InstantRules;

export default rules;
