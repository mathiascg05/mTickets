import { adminDb } from "@/lib/adminDb";
import {
  buildEntitlements,
  unwrapOne,
  type Entitlement,
  type IncludedExtraLink,
  type PurchasedExtraItem,
} from "@/lib/extras";

export type ScanExtrasResponse = {
  entitlements: Entitlement[];
  currency: string;
  approved: boolean;
};

type ConcertShape = {
  id: string;
  organizerEmail?: string;
  currency?: string;
  collaborators?: { email: string; role?: string | null }[];
};

/**
 * Everything the holder of one QR can redeem: the extras included with their own
 * ticket type plus the pool their checkout bought. Shared with the redeem route
 * so both derive the balance from exactly the same rows.
 */
export async function loadEntitlements(orderId: string): Promise<{
  entitlements: Entitlement[];
  order?: { id: string; status?: string };
  concert?: ConcertShape & { organizerEmail: string };
  groupId?: string;
}> {
  const { orders } = await adminDb.query({
    orders: {
      $: { where: { id: orderId } },
      ticketType: {
        concert: { collaborators: {} },
        includedExtras: { extra: {} },
      },
      extraPurchaseGroup: {
        items: { extra: {} },
      },
    },
  });

  const order = orders[0] as
    | {
        id: string;
        status?: string;
        ticketType?: unknown;
        extraPurchaseGroup?: unknown;
      }
    | undefined;
  if (!order) return { entitlements: [] };

  const ticketType = unwrapOne<{
    concert?: unknown;
    includedExtras?: IncludedExtraLink[];
  }>(order.ticketType);
  const concert = unwrapOne<ConcertShape>(ticketType?.concert);
  const group = unwrapOne<{ id: string; items?: PurchasedExtraItem[] }>(
    order.extraPurchaseGroup,
  );

  const includedLinks = ticketType?.includedExtras ?? [];
  const hasAny = includedLinks.length > 0 || (group?.items?.length ?? 0) > 0;

  // The balance is always derived, never stored: read every redemption row of
  // the pools this QR can touch and count them.
  let redemptions: { poolKey: string; unitIndex: number }[] = [];
  if (hasAny) {
    const poolKeys = new Set<string>();
    for (const link of includedLinks) {
      const extra = unwrapOne<{ id: string }>(link.extra);
      if (extra) poolKeys.add(`inc:${order.id}:${extra.id}`);
    }
    if (group) {
      for (const item of group.items ?? []) {
        const extra = unwrapOne<{ id: string }>(item.extra);
        if (extra) poolKeys.add(`grp:${group.id}:${extra.id}`);
      }
    }
    if (poolKeys.size > 0) {
      const { extraRedemptions } = await adminDb.query({
        extraRedemptions: {
          $: { where: { poolKey: { $in: [...poolKeys] } } },
        },
      });
      redemptions = extraRedemptions as { poolKey: string; unitIndex: number }[];
    }
  }

  return {
    entitlements: buildEntitlements({
      orderId: order.id,
      includedLinks,
      group,
      redemptions,
    }),
    order,
    concert: concert
      ? { ...concert, organizerEmail: concert.organizerEmail ?? "" }
      : undefined,
    groupId: group?.id,
  };
}
