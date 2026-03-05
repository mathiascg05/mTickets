import type { InstantRules } from "@instantdb/react";

const rules = {
  concerts: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  ticketTypes: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  orders: {
    allow: {
      view: "true",
      create: "false",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  paymentMethods: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  promoters: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  ticketPhases: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  coupons: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  reservations: {
    allow: {
      view: "true",
      create: "false",
      update: "isAdmin",
      delete: "false",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  exchangeRates: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", "auth.email == 'mcarstensg@gmail.com'"],
  },
  $files: {
    allow: {
      view: "auth.email == 'mcarstensg@gmail.com'",
      create: "true",
    },
  },
} satisfies InstantRules;

export default rules;
