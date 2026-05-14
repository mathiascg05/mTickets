import { adminDb } from "@/lib/adminDb";
import { isEmailSuppressed } from "@/lib/emailSuppression";

export type BroadcastFilters = {
  ticketTypeIds?: string[];
  paymentMethodTypes?: string[];
  orderStatuses?: string[];
};

export type BroadcastRecipient = {
  email: string;
  firstName: string;
  lastName: string;
  ticketTypeName: string;
  paymentMethod: string;
  status: string;
  language?: string;
};

export type ResolvedRecipients = {
  recipients: BroadcastRecipient[];
  suppressedEmails: string[];
};

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function unwrapOne<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return value as T | undefined;
}

export async function resolveRecipients(
  concertId: string,
  filters: BroadcastFilters,
): Promise<ResolvedRecipients> {
  const { ticketTypeIds, paymentMethodTypes, orderStatuses } = filters;

  const where: Record<string, unknown> = {
    "ticketType.concert.id": concertId,
  };
  if (orderStatuses && orderStatuses.length > 0) {
    where.status = { $in: orderStatuses };
  }
  if (paymentMethodTypes && paymentMethodTypes.length > 0) {
    // Orders store the human-readable PM name (see create-order route), not the
    // PM type. Expand the selected types to all matching PM names of this
    // concert so chips that cover multiple accounts (e.g. two Pago Móvil
    // accounts sharing the same type) still match every order.
    const { paymentMethods: pms = [] } = await adminDb.query({
      paymentMethods: {
        $: {
          where: {
            "concert.id": concertId,
            type: { $in: paymentMethodTypes },
          },
        },
      },
    });
    const names = Array.from(
      new Set(
        pms
          .map((p) => (p as { name?: string }).name)
          .filter((n): n is string => Boolean(n)),
      ),
    );
    if (names.length === 0) {
      return { recipients: [], suppressedEmails: [] };
    }
    where.paymentMethod = { $in: names };
  }
  if (ticketTypeIds && ticketTypeIds.length > 0) {
    where["ticketType.id"] = { $in: ticketTypeIds };
  }

  const { orders = [] } = await adminDb.query({
    orders: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $: { where: where as any },
      ticketType: {},
    },
  });

  // Deduplicate by lowercased email, keep first occurrence.
  const seen = new Map<string, BroadcastRecipient>();
  for (const o of orders) {
    if (!o.email) continue;
    const key = normalize(o.email);
    if (seen.has(key)) continue;
    const tt = unwrapOne<{ name?: string }>(o.ticketType);
    seen.set(key, {
      email: o.email,
      firstName: o.firstName ?? "",
      lastName: o.lastName ?? "",
      ticketTypeName: tt?.name ?? "",
      paymentMethod: o.paymentMethod ?? "",
      status: o.status ?? "",
      language: (o as { language?: string }).language,
    });
  }

  // Filter out suppressed emails.
  const suppressedEmails: string[] = [];
  const recipients: BroadcastRecipient[] = [];
  for (const r of seen.values()) {
    if (await isEmailSuppressed(r.email)) {
      suppressedEmails.push(r.email);
    } else {
      recipients.push(r);
    }
  }

  return { recipients, suppressedEmails };
}
