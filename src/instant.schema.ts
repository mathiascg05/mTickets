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
      firstName: i.string().optional(),
      lastName: i.string().optional(),
      phone: i.string().optional(),
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
      flyerPath: i.string().optional(),
      logoUrl: i.string().optional(),
      logoPath: i.string().optional(),
      primaryColor: i.string().optional(),
      themeColors: i.string().optional(),
      paletteRefPath: i.string().optional(),
      paletteRefUrl: i.string().optional(),
      lastOrderSeq: i.number().optional().indexed(),
      orderNumberPrefix: i.string().optional().unique().indexed(),
      organizerEmail: i.string().indexed(),
      defaultLanguage: i.string().optional(),
      isDemo: i.boolean().optional().indexed(),
      finalizedAt: i.number().optional().indexed(),
      feeMode: i.string().optional(),
      // Locale del evento. No cambian comportamiento todavia: `currency` solo
      // decide el simbolo que se muestra (ver src/lib/currency.ts).
      country: i.string().optional(),
      currency: i.string().optional(),
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
      peoplePerTicket: i.number().optional(),
      imagePath: i.string().optional(),
      imageUrl: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    orders: i.entity({
      firstName: i.string(),
      lastName: i.string(),
      email: i.string().indexed(),
      cedula: i.string().indexed(),
      phone: i.string().optional(),
      paymentMethod: i.string(),
      promoter: i.string().optional(),
      customFieldValues: i.string().optional(),
      status: i.string().indexed(),
      paymentProofPath: i.string().optional(),
      proofReferenceNumber: i.string().optional(),
      visited: i.boolean().indexed(),
      visitedAt: i.number().optional().indexed(),
      couponCode: i.string().optional(),
      discountAmount: i.number().optional(),
      paymentMethodDiscount: i.number().optional(),
      phaseId: i.string().optional(),
      allotmentId: i.string().optional().indexed(),
      allotmentSeq: i.number().optional(),
      delivered: i.boolean().optional(),
      orderNumber: i.string().optional().unique().indexed(),
      // Client checkout submission id. Shared by all orders of one submission;
      // powers create-order idempotency (indexed, NOT unique).
      idempotencyKey: i.string().optional().indexed(),
      purchaseGroupId: i.string().optional().indexed(),
      purchaseRate: i.number().optional(),
      purchaseRateCurrency: i.string().optional(),
      purchaseAmountBs: i.number().optional(),
      priceSnapshot: i.number().optional(),
      feePercentSnapshot: i.number().optional(),
      feeFixedSnapshot: i.number().optional(),
      feeAmountSnapshot: i.number().optional(),
      totalSnapshot: i.number().optional(),
      platformFeePercentSnapshot: i.number().optional(),
      platformFeeFixedSnapshot: i.number().optional(),
      platformFeeAmountSnapshot: i.number().optional(),
      paymentMethodFeePercentSnapshot: i.number().optional(),
      paymentMethodFeeFixedSnapshot: i.number().optional(),
      paymentMethodFeeAmountSnapshot: i.number().optional(),
      // Extras comprados en el checkout. Solo se escriben en la orden ANCLA del
      // checkout (indice 0), igual que el cupon y purchaseAmountBs solo viven en
      // la primary. `extrasSubtotalSnapshot` ya esta SUMADO dentro de
      // `totalSnapshot`, y su parte porcentual dentro de
      // `platformFeeAmountSnapshot`, para que los totales e ingresos del panel
      // cuadren sin tocar order-pricing ni approveOrder.
      extrasSubtotalSnapshot: i.number().optional(),
      extrasPlatformFeeSnapshot: i.number().optional(),
      extrasAmountBs: i.number().optional(),
      acceptedTermsVersion: i.string().optional(),
      acceptedPrivacyVersion: i.string().optional(),
      language: i.string().optional(),
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
      customRate: i.number().optional(),
      zelleEmail: i.string().optional(),
      zelleName: i.string().optional(),
      pmCedula: i.string().optional(),
      pmPhone: i.string().optional(),
      pmBank: i.string().optional(),
      discountType: i.string().optional(),
      discountValue: i.number().optional(),
      feePercent: i.number().optional(),
      feeFixed: i.number().optional(),
      // Metodo de prueba: sus ordenes se excluyen por defecto de Ingresos
      // Totales, Totales Combinados y la curva de ventas del panel.
      isTest: i.boolean().optional().indexed(),
      createdAt: i.number().indexed(),
    }),
    extras: i.entity({
      // Catalogo de extras de un concierto: franela, combo de bebidas, trago de
      // cortesia, valet parking.
      name: i.string(),
      description: i.string().optional(),
      price: i.number(),
      // Ausente = stock ilimitado.
      stock: i.number().optional(),
      active: i.boolean().indexed(),
      // Aparece o no en el checkout. Un extra no comprable solo puede llegar
      // incluido en un ticketType.
      purchasable: i.boolean().indexed(),
      sortOrder: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    ticketTypeExtras: i.entity({
      // Join ticketType <-> extra: "este tipo de entrada incluye N unidades".
      // El derecho es POR TICKET/QR, asi que en areas cada acompanante tiene el
      // suyo.
      includedQty: i.number(),
      createdAt: i.number().indexed(),
    }),
    extraPurchaseGroups: i.entity({
      // Ancla del pool de extras comprados: UNA fila por checkout que compro
      // extras, enlazada a todas las ordenes de ese checkout. No se puede usar
      // orders.purchaseGroupId porque en areas create-order genera un
      // purchaseGroupId por unidad (N grupos en un solo checkout).
      submissionId: i.string().optional().indexed(),
      anchorOrderId: i.string().indexed(),
      subtotalSnapshot: i.number(),
      createdAt: i.number().indexed(),
    }),
    extraPurchaseItems: i.entity({
      // Linea comprada, con snapshots de precio como en orders.
      quantity: i.number(),
      unitPriceSnapshot: i.number(),
      subtotalSnapshot: i.number(),
      // Sobrevive a un rename posterior del extra.
      extraNameSnapshot: i.string(),
      createdAt: i.number().indexed(),
    }),
    extraRedemptions: i.entity({
      // Append-only: UNA fila = UNA unidad canjeada. El saldo nunca se guarda,
      // siempre se deriva de (derecho total - COUNT(filas del pool)).
      // El id de la fila es deterministico a partir de (poolKey, unitIndex) —
      // ver extraRedemptionId en src/lib/deterministicId.ts — asi que el espacio
      // de ids de un pool de N unidades tiene exactamente N valores y es
      // imposible sobre-canjear aunque dos dispositivos escriban a la vez.
      poolKey: i.string().indexed(),
      unitIndex: i.number(),
      source: i.string().indexed(),
      clientRequestId: i.string().optional().indexed(),
      redeemedAt: i.number().indexed(),
      redeemedByEmail: i.string().optional().indexed(),
      redeemedByScanner: i.boolean().optional(),
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
      language: i.string().optional(),
      attachments: i.string().optional(),
      accessToken: i.string().unique().indexed().optional(),
      tokenExpiresAt: i.number().optional().indexed(),
      lastActivityAt: i.number().optional().indexed(),
      createdAt: i.number().indexed(),
    }),
    messageReplies: i.entity({
      body: i.string(),
      sender: i.string().indexed(),
      authorEmail: i.string().optional(),
      attachments: i.string().optional(),
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
      allowOverdraft: i.boolean().optional().indexed(),
      overdraftActivatedAt: i.number().optional().indexed(),
      overdraftActivatedBy: i.string().optional(),
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
    eventCollaborators: i.entity({
      email: i.string().indexed(),
      // "co_organizer" (full config access) | "box_office" (operational only).
      // Optional/absent is treated as "co_organizer" for backwards compat.
      role: i.string().optional().indexed(),
      invitedAt: i.number().indexed(),
      invitedByEmail: i.string(),
      inviteSentAt: i.number().optional(),
      lastAccessedAt: i.number().indexed().optional(),
    }),
    broadcasts: i.entity({
      subject: i.string(),
      body: i.string(),
      filtersJson: i.string(),
      recipientCount: i.number().indexed(),
      sentCount: i.number(),
      failedCount: i.number(),
      suppressedCount: i.number(),
      status: i.string().indexed(),
      createdByEmail: i.string().indexed(),
      createdAt: i.number().indexed(),
      completedAt: i.number().optional().indexed(),
      failedEmailsJson: i.string().optional(),
      processingState: i.string().optional().indexed(),
      lastWorkerAt: i.number().optional().indexed(),
    }),
    broadcastDeliveries: i.entity({
      email: i.string().indexed(),
      emailDisplay: i.string(),
      firstName: i.string(),
      lastName: i.string(),
      ticketTypeName: i.string(),
      paymentMethod: i.string(),
      orderStatus: i.string(),
      language: i.string().optional(),
      deliveryStatus: i.string().indexed(),
      attempts: i.number().indexed(),
      lastTriedAt: i.number().optional().indexed(),
      sentAt: i.number().optional().indexed(),
      failedAt: i.number().optional().indexed(),
      reason: i.string().optional(),
      claimToken: i.string().optional().indexed(),
      claimedAt: i.number().optional().indexed(),
      createdAt: i.number().indexed(),
    }),
    guestListEvents: i.entity({
      name: i.string(),
      slug: i.string().unique().indexed(),
      date: i.string(),
      venue: i.string().optional(),
      venueMapUrl: i.string().optional(),
      description: i.string().optional(),
      status: i.string().indexed(),
      flyerUrl: i.string().optional(),
      flyerPath: i.string().optional(),
      logoUrl: i.string().optional(),
      logoPath: i.string().optional(),
      primaryColor: i.string().optional(),
      themeColors: i.string().optional(),
      paletteRefPath: i.string().optional(),
      paletteRefUrl: i.string().optional(),
      organizerEmail: i.string().indexed(),
      defaultLanguage: i.string().optional(),
      scannerPin: i.string().optional(),
      defaultPrice: i.number(),
      capacity: i.number().optional(),
      lastOrderSeq: i.number().optional().indexed(),
      orderNumberPrefix: i.string().optional().indexed(),
      isDemo: i.boolean().optional().indexed(),
      finalizedAt: i.number().optional().indexed(),
      feeMode: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    guestListEntries: i.entity({
      email: i.string().optional().indexed(),
      cedula: i.string().optional().indexed(),
      firstName: i.string().optional(),
      lastName: i.string().optional(),
      priceOverride: i.number().optional(),
      status: i.string().indexed(),
      inviteToken: i.string().unique().indexed(),
      inviteSentAt: i.number().optional().indexed(),
      registeredAt: i.number().optional().indexed(),
      createdAt: i.number().indexed(),
    }),
    guestListOrders: i.entity({
      firstName: i.string(),
      lastName: i.string(),
      email: i.string().indexed(),
      cedula: i.string().indexed(),
      status: i.string().indexed(),
      visited: i.boolean().indexed(),
      visitedAt: i.number().optional().indexed(),
      paymentMethod: i.string().optional(),
      paymentMethodId: i.string().optional().indexed(),
      paymentProofPath: i.string().optional(),
      proofReferenceNumber: i.string().optional(),
      pricePaid: i.number(),
      priceSnapshot: i.number().optional(),
      feePercentSnapshot: i.number().optional(),
      feeFixedSnapshot: i.number().optional(),
      feeAmountSnapshot: i.number().optional(),
      platformFeePercentSnapshot: i.number().optional(),
      platformFeeFixedSnapshot: i.number().optional(),
      platformFeeAmountSnapshot: i.number().optional(),
      paymentMethodFeePercentSnapshot: i.number().optional(),
      paymentMethodFeeFixedSnapshot: i.number().optional(),
      paymentMethodFeeAmountSnapshot: i.number().optional(),
      purchaseRate: i.number().optional(),
      purchaseRateCurrency: i.string().optional(),
      purchaseAmountBs: i.number().optional(),
      customFieldValues: i.string().optional(),
      orderNumber: i.string().optional().unique().indexed(),
      orderToken: i.string().unique().indexed(),
      language: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    guestListPaymentMethods: i.entity({
      type: i.string().indexed(),
      name: i.string(),
      instructions: i.string().optional(),
      convertCurrency: i.string().optional(),
      requireScreenshot: i.boolean().optional(),
      requireReferenceNumber: i.boolean().optional(),
      showConversionDetail: i.boolean().optional(),
      customRate: i.number().optional(),
      zelleEmail: i.string().optional(),
      zelleName: i.string().optional(),
      pmCedula: i.string().optional(),
      pmPhone: i.string().optional(),
      pmBank: i.string().optional(),
      discountType: i.string().optional(),
      discountValue: i.number().optional(),
      feePercent: i.number().optional(),
      feeFixed: i.number().optional(),
      sortOrder: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    guestListCustomFields: i.entity({
      label: i.string(),
      fieldType: i.string(),
      required: i.boolean(),
      options: i.string().optional(),
      sortOrder: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    guestListCollaborators: i.entity({
      email: i.string().indexed(),
      // "co_organizer" (full config access) | "box_office" (operational only).
      // Optional/absent is treated as "co_organizer" for backwards compat.
      role: i.string().optional().indexed(),
      invitedAt: i.number().indexed(),
      invitedByEmail: i.string(),
    }),
    guestListTicketTypes: i.entity({
      name: i.string(),
      price: i.number(),
      quantity: i.number().optional(),
      description: i.string().optional(),
      feePercent: i.number().optional(),
      feeFixed: i.number().optional(),
      sortOrder: i.number().indexed(),
      createdAt: i.number().indexed(),
    }),
    guestListPlatformFeeConfigs: i.entity({
      feePercent: i.number(),
      feeFixed: i.number(),
      billingMode: i.string().indexed(),
      updatedAt: i.number().indexed(),
    }),
    ticketAllotments: i.entity({
      schoolName: i.string(),
      contactEmail: i.string().optional().indexed(),
      contactPhone: i.string().optional(),
      status: i.string().indexed(),
      totalPrice: i.number(),
      ticketCount: i.number(),
      paymentMethodId: i.string().optional().indexed(),
      paymentMethod: i.string().optional(),
      paymentProofPath: i.string().optional(),
      proofReferenceNumber: i.string().optional(),
      purchaseRate: i.number().optional(),
      purchaseRateCurrency: i.string().optional(),
      purchaseAmountBs: i.number().optional(),
      manageToken: i.string().unique().indexed(),
      tokenExpiresAt: i.number().optional().indexed(),
      feeAmountSnapshot: i.number().optional(),
      ordersGeneratedAt: i.number().optional().indexed(),
      inviteSentAt: i.number().optional().indexed(),
      submittedAt: i.number().optional().indexed(),
      approvedAt: i.number().optional().indexed(),
      rejectedAt: i.number().optional().indexed(),
      language: i.string().optional(),
      createdAt: i.number().indexed(),
    }),
    ticketAllotmentItems: i.entity({
      quantity: i.number(),
      // Mirrors the parent allotment.status so public availability can subtract
      // committed quantity without exposing the private ticketAllotments entity.
      status: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    auditLogs: i.entity({
      action: i.string().indexed(),
      actorEmail: i.string().indexed(),
      entityType: i.string().indexed(),
      entityId: i.string().indexed(),
      concertId: i.string().optional().indexed(),
      guestListEventId: i.string().optional().indexed(),
      summary: i.string(),
      metadataJson: i.string().optional(),
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
    concertExtras: {
      forward: {
        on: "extras",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "extras",
      },
    },
    ticketTypeExtrasTicketType: {
      forward: {
        on: "ticketTypeExtras",
        has: "one",
        label: "ticketType",
        onDelete: "cascade",
      },
      reverse: {
        on: "ticketTypes",
        has: "many",
        label: "includedExtras",
      },
    },
    ticketTypeExtrasExtra: {
      forward: {
        on: "ticketTypeExtras",
        has: "one",
        label: "extra",
        onDelete: "cascade",
      },
      reverse: {
        on: "extras",
        has: "many",
        label: "ticketTypeLinks",
      },
    },
    extraPurchaseGroupConcert: {
      forward: {
        on: "extraPurchaseGroups",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "extraPurchaseGroups",
      },
    },
    // SIN cascade a proposito: onDelete en el forward has-one borra la entidad
    // forward (la orden) cuando muere la enlazada, y borrar un grupo de extras
    // jamas debe borrar entradas vendidas. El grupo muere con el concierto via
    // extraPurchaseGroupConcert. Mismo criterio que balanceTransactionBalance.
    extraPurchaseGroupOrders: {
      forward: {
        on: "orders",
        has: "one",
        label: "extraPurchaseGroup",
      },
      reverse: {
        on: "extraPurchaseGroups",
        has: "many",
        label: "orders",
      },
    },
    extraPurchaseItemsGroup: {
      forward: {
        on: "extraPurchaseItems",
        has: "one",
        label: "group",
        onDelete: "cascade",
      },
      reverse: {
        on: "extraPurchaseGroups",
        has: "many",
        label: "items",
      },
    },
    extraPurchaseItemsExtra: {
      forward: {
        on: "extraPurchaseItems",
        has: "one",
        label: "extra",
      },
      reverse: {
        on: "extras",
        has: "many",
        label: "purchaseItems",
      },
    },
    extraRedemptionsExtra: {
      forward: {
        on: "extraRedemptions",
        has: "one",
        label: "extra",
      },
      reverse: {
        on: "extras",
        has: "many",
        label: "redemptions",
      },
    },
    extraRedemptionsOrder: {
      forward: {
        on: "extraRedemptions",
        has: "one",
        label: "fromOrder",
      },
      reverse: {
        on: "orders",
        has: "many",
        label: "extraRedemptions",
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
    messageThreadReplies: {
      forward: {
        on: "messageReplies",
        has: "one",
        label: "message",
        onDelete: "cascade",
      },
      reverse: {
        on: "messages",
        has: "many",
        label: "replies",
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
    concertCollaborators: {
      forward: {
        on: "eventCollaborators",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "collaborators",
      },
    },
    // Manager tier: subset of collaborators (role "co_organizer") who may edit
    // event configuration. Enforced in instant.perms.ts via data.ref('...managers.email').
    // Maintained server-side only (link added/removed alongside role changes).
    concertManagers: {
      forward: {
        on: "eventCollaborators",
        has: "one",
        label: "managerConcert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "managers",
      },
    },
    concertBroadcasts: {
      forward: {
        on: "broadcasts",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "broadcasts",
      },
    },
    broadcastDeliveryItems: {
      forward: {
        on: "broadcastDeliveries",
        has: "one",
        label: "broadcast",
        onDelete: "cascade",
      },
      reverse: {
        on: "broadcasts",
        has: "many",
        label: "deliveries",
      },
    },
    guestListEntriesEvent: {
      forward: {
        on: "guestListEntries",
        has: "one",
        label: "event",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "many",
        label: "entries",
      },
    },
    guestListOrderEntry: {
      forward: {
        on: "guestListOrders",
        has: "one",
        label: "entry",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEntries",
        has: "one",
        label: "order",
      },
    },
    guestListPaymentMethodEvent: {
      forward: {
        on: "guestListPaymentMethods",
        has: "one",
        label: "event",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "many",
        label: "paymentMethods",
      },
    },
    guestListCustomFieldsEvent: {
      forward: {
        on: "guestListCustomFields",
        has: "one",
        label: "event",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "many",
        label: "customFields",
      },
    },
    guestListCollaboratorsEvent: {
      forward: {
        on: "guestListCollaborators",
        has: "one",
        label: "event",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "many",
        label: "collaborators",
      },
    },
    // Manager tier for guest lists: subset of collaborators (role "co_organizer")
    // allowed to edit configuration. Maintained server-side only.
    guestListManagers: {
      forward: {
        on: "guestListCollaborators",
        has: "one",
        label: "managerEvent",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "many",
        label: "managers",
      },
    },
    guestListTicketTypesEvent: {
      forward: {
        on: "guestListTicketTypes",
        has: "one",
        label: "event",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "many",
        label: "ticketTypes",
      },
    },
    guestListEntriesTicketType: {
      forward: {
        on: "guestListEntries",
        has: "one",
        label: "ticketType",
      },
      reverse: {
        on: "guestListTicketTypes",
        has: "many",
        label: "entries",
      },
    },
    guestListOrdersTicketType: {
      forward: {
        on: "guestListOrders",
        has: "one",
        label: "ticketType",
      },
      reverse: {
        on: "guestListTicketTypes",
        has: "many",
        label: "orders",
      },
    },
    guestListPlatformFee: {
      forward: {
        on: "guestListPlatformFeeConfigs",
        has: "one",
        label: "event",
        onDelete: "cascade",
      },
      reverse: {
        on: "guestListEvents",
        has: "one",
        label: "platformFeeConfig",
      },
    },
    concertAllotments: {
      forward: {
        on: "ticketAllotments",
        has: "one",
        label: "concert",
        onDelete: "cascade",
      },
      reverse: {
        on: "concerts",
        has: "many",
        label: "allotments",
      },
    },
    allotmentItemsAllotment: {
      forward: {
        on: "ticketAllotmentItems",
        has: "one",
        label: "allotment",
        onDelete: "cascade",
      },
      reverse: {
        on: "ticketAllotments",
        has: "many",
        label: "items",
      },
    },
    allotmentItemsTicketType: {
      forward: {
        on: "ticketAllotmentItems",
        has: "one",
        label: "ticketType",
      },
      reverse: {
        on: "ticketTypes",
        has: "many",
        label: "allotmentItems",
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
