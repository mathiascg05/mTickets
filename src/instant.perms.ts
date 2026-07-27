import type { InstantRules } from "@instantdb/react";

const SUPER_ADMIN = "matickets.ve@gmail.com";

const rules = {
  $users: {
    allow: {
      view: `auth.id == data.id || auth.email == '${SUPER_ADMIN}'`,
    },
  },
  concerts: {
    allow: {
      view: "true",
      create: "auth.email != null",
      // Editing event config is manager-tier (organizer + co_organizer collaborators).
      // Box-office collaborators are excluded here.
      update: "isManager || isSuperAdmin",
      delete: "isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email == data.organizerEmail || auth.email in data.ref('collaborators.email')",
      "isManager",
      "auth.email == data.organizerEmail || auth.email in data.ref('managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      scannerPin: "isManager || isSuperAdmin",
    },
  },
  ticketTypes: {
    allow: {
      view: "data.ref('concert.status') == ['active'] || isOwner || isSuperAdmin",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
      "isManager",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.managers.email')",
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
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
      "isManager",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  customFields: {
    allow: {
      view: "true",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isManager",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  ticketPhases: {
    allow: {
      view: "true",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isManager",
      "auth.email in data.ref('ticketType.concert.organizerEmail') || auth.email in data.ref('ticketType.concert.managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  coupons: {
    allow: {
      view: "true",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isManager",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.managers.email')",
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
    fields: {
      accessToken: `auth.email == '${SUPER_ADMIN}'`,
    },
  },
  messageReplies: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "false",
      update: "false",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('message.concert.organizerEmail') || auth.email in data.ref('message.concert.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  broadcasts: {
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
  broadcastDeliveries: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "false",
      update: "false",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('broadcast.concert.organizerEmail') || auth.email in data.ref('broadcast.concert.collaborators.email')",
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
  guestListEvents: {
    allow: {
      view: "data.status == 'active' || isOwner || isSuperAdmin",
      create: "auth.email != null",
      update: "isManager || isSuperAdmin",
      delete: "isPrimaryOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email == data.organizerEmail || auth.email in data.ref('collaborators.email')",
      "isManager",
      "auth.email == data.organizerEmail || auth.email in data.ref('managers.email')",
      "isPrimaryOwner",
      "auth.email == data.organizerEmail",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      scannerPin: "isManager || isSuperAdmin",
    },
  },
  guestListEntries: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "false",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('event.organizerEmail') || auth.email in data.ref('event.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  guestListOrders: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "false",
      update: "isOwner || isSuperAdmin",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('entry.event.organizerEmail') || auth.email in data.ref('entry.event.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  guestListPaymentMethods: {
    allow: {
      view: "data.ref('event.status') == ['active'] || isOwner || isSuperAdmin",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('event.organizerEmail') || auth.email in data.ref('event.collaborators.email')",
      "isManager",
      "auth.email in data.ref('event.organizerEmail') || auth.email in data.ref('event.managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  guestListCustomFields: {
    allow: {
      view: "true",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isManager",
      "auth.email in data.ref('event.organizerEmail') || auth.email in data.ref('event.managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  guestListTicketTypes: {
    allow: {
      view: "true",
      create: "isManager || isSuperAdmin",
      update: "isManager || isSuperAdmin",
      delete: "isManager || isSuperAdmin",
    },
    bind: [
      "isManager",
      "auth.email in data.ref('event.organizerEmail') || auth.email in data.ref('event.managers.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  guestListPlatformFeeConfigs: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "isSuperAdmin",
      update: "isSuperAdmin",
      delete: "isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('event.organizerEmail') || auth.email in data.ref('event.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  guestListCollaborators: {
    allow: {
      view: "isOwner || isCollaborator || isSuperAdmin",
      create: "isPrimaryOwner || isSuperAdmin",
      update: "false",
      delete: "isPrimaryOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('event.organizerEmail')",
      "isCollaborator",
      "auth.email in data.ref('event.collaborators.email')",
      "isPrimaryOwner",
      "auth.email in data.ref('event.organizerEmail')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  ticketAllotments: {
    allow: {
      view: "isOwner || isSuperAdmin",
      create: "false",
      update: "false",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('concert.organizerEmail') || auth.email in data.ref('concert.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
    fields: {
      manageToken: `auth.email == '${SUPER_ADMIN}'`,
      paymentProofPath: "isOwner || isSuperAdmin",
      proofReferenceNumber: "isOwner || isSuperAdmin",
    },
  },
  ticketAllotmentItems: {
    allow: {
      view: "true",
      create: "false",
      update: "false",
      delete: "isOwner || isSuperAdmin",
    },
    bind: [
      "isOwner",
      "auth.email in data.ref('allotment.concert.organizerEmail') || auth.email in data.ref('allotment.concert.collaborators.email')",
      "isSuperAdmin",
      `auth.email == '${SUPER_ADMIN}'`,
    ],
  },
  auditLogs: {
    allow: {
      view: "false",
      create: "false",
      update: "false",
      delete: "false",
    },
    bind: [],
  },
  $files: {
    allow: {
      view: `data.path.startsWith('event-assets/') || data.path.startsWith('ticket-type-assets/') || data.path.startsWith('message-attachments/') || auth.email == '${SUPER_ADMIN}'`,
      create:
        "data.path.startsWith('payment-proofs/') || data.path.startsWith('message-attachments/') || (auth.email != null && (data.path.startsWith('event-assets/') || data.path.startsWith('ticket-type-assets/')))",
      delete:
        `auth.email != null && (data.path.startsWith('event-assets/') || data.path.startsWith('ticket-type-assets/') || auth.email == '${SUPER_ADMIN}')`,
    },
  },
} satisfies InstantRules;

export default rules;
