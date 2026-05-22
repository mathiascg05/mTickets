import { id } from "@instantdb/admin";
import { adminDb } from "../src/lib/adminDb";
import { generateInviteToken } from "../src/lib/guestListTokens";

type MessageRow = {
  id: string;
  status?: string;
  adminReply?: string;
  repliedAt?: number;
  accessToken?: string;
  tokenExpiresAt?: number;
  lastActivityAt?: number;
  createdAt: number;
};

const TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;

async function backfill() {
  const { messages } = await adminDb.query({ messages: {} });
  console.log(`Scanning ${messages.length} messages…`);

  let tokenAdded = 0;
  let repliesSynthesized = 0;
  let activityBackfilled = 0;

  for (const m of messages as MessageRow[]) {
    const updates: Record<string, unknown> = {};
    const txs: unknown[] = [];

    if (!m.accessToken) {
      updates.accessToken = generateInviteToken();
      updates.tokenExpiresAt = m.createdAt + TOKEN_TTL_MS;
      tokenAdded++;
    }

    if (!m.lastActivityAt) {
      updates.lastActivityAt = m.repliedAt ?? m.createdAt;
      activityBackfilled++;
    }

    if (m.adminReply && m.status === "replied") {
      const { messageReplies } = await adminDb.query({
        messageReplies: {
          $: { where: { "message.id": m.id, sender: "organizer" } },
        },
      });
      if (messageReplies.length === 0) {
        const replyId = id();
        txs.push(
          adminDb.tx.messageReplies[replyId]
            .create({
              body: m.adminReply,
              sender: "organizer",
              createdAt: m.repliedAt ?? m.createdAt,
            })
            .link({ message: m.id }),
        );
        repliesSynthesized++;
      }
    }

    if (Object.keys(updates).length === 0 && txs.length === 0) continue;

    const all = [...txs];
    if (Object.keys(updates).length > 0) {
      all.push(adminDb.tx.messages[m.id].update(updates));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adminDb.transact(all as any);
  }

  console.log(
    `Done. tokens added: ${tokenAdded}, lastActivityAt backfilled: ${activityBackfilled}, organizer replies synthesized: ${repliesSynthesized}`,
  );
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
