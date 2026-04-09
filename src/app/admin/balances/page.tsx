"use client";

import { db } from "@/lib/db";
import { id } from "@instantdb/react";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { useState } from "react";

export default function BalancesPage() {
  const { isSuperAdmin } = useAuthContext();
  const { t } = useLanguage();
  const [creditEmail, setCreditEmail] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"balances" | "report">("balances");

  const { isLoading, data } = db.useQuery({
    organizerBalances: {
      transactions: {
        $: { order: { createdAt: "desc" } },
      },
    },
    concerts: {
      $: { order: { createdAt: "desc" } },
      platformFeeConfig: {},
    },
  });

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-20 text-muted">
        Access denied. Super admin only.
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  const { organizerBalances, concerts } = data;

  // Get unique organizer emails from concerts
  const organizerEmails = [
    ...new Set(concerts.map((c) => c.organizerEmail.toLowerCase())),
  ].sort();

  async function handleCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!creditEmail || !creditAmount) return;
    setCrediting(true);

    try {
      const amount = parseFloat(creditAmount);
      if (isNaN(amount) || amount <= 0) {
        alert("Invalid amount");
        return;
      }

      const email = creditEmail.toLowerCase().trim();
      const existing = organizerBalances.find((b) => b.email === email);

      const balanceBefore = existing?.balance || 0;
      const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
      const txnId = id();

      if (existing) {
        // Update existing balance + create transaction
        await db.transact([
          db.tx.organizerBalances[existing.id].update({
            balance: balanceAfter,
            updatedAt: Date.now(),
          }),
          db.tx.balanceTransactions[txnId]
            .update({
              type: "deposit",
              amount,
              balanceBefore,
              balanceAfter,
              description: creditNote || "Manual deposit",
              createdAt: Date.now(),
            })
            .link({ organizerBalance: existing.id }),
        ]);
      } else {
        // Create new balance + transaction
        const balanceId = id();
        await db.transact([
          db.tx.organizerBalances[balanceId].update({
            email,
            balance: balanceAfter,
            currency: "USD",
            updatedAt: Date.now(),
          }),
          db.tx.balanceTransactions[txnId]
            .update({
              type: "deposit",
              amount,
              balanceBefore: 0,
              balanceAfter,
              description: creditNote || "Initial deposit",
              createdAt: Date.now(),
            })
            .link({ organizerBalance: balanceId }),
        ]);
      }

      setCreditAmount("");
      setCreditNote("");
    } catch (err) {
      console.error("Failed to credit account:", err);
      alert("Error crediting account");
    } finally {
      setCrediting(false);
    }
  }

  // Build postpaid report data
  const postpaidConcerts = concerts.filter((c) => {
    const fc = c.platformFeeConfig as unknown;
    const config = Array.isArray(fc) ? fc[0] : fc;
    return (config as { billingMode?: string } | null)?.billingMode === "postpaid";
  });
  const postpaidConcertIds = new Set(postpaidConcerts.map((c) => c.id));

  // Group fee transactions by organizer email
  const reportByOrganizer = new Map<string, { totalFees: number; totalDeposits: number; concerts: Map<string, number> }>();
  for (const bal of organizerBalances) {
    const orgConcerts = concerts.filter((c) => c.organizerEmail.toLowerCase() === bal.email);
    const hasPostpaid = orgConcerts.some((c) => postpaidConcertIds.has(c.id));
    if (!hasPostpaid && bal.balance >= 0) continue;

    const entry = { totalFees: 0, totalDeposits: 0, concerts: new Map<string, number>() };
    for (const txn of bal.transactions || []) {
      if (txn.type === "fee") {
        entry.totalFees += Math.abs(txn.amount);
        if (txn.concertId) {
          entry.concerts.set(txn.concertId, (entry.concerts.get(txn.concertId) || 0) + Math.abs(txn.amount));
        }
      }
      if (txn.type === "deposit") {
        entry.totalDeposits += txn.amount;
      }
    }
    if (entry.totalFees > 0 || bal.balance < 0) {
      reportByOrganizer.set(bal.email, entry);
    }
  }

  const concertNameMap = new Map(concerts.map((c) => [c.id, c.name]));

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">{t("admin.balances")}</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab("balances")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "balances"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t("admin.balances")}
        </button>
        <button
          onClick={() => setActiveTab("report")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "report"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t("admin.postpaidReport")}
        </button>
      </div>

      {activeTab === "report" && (
        <div className="space-y-4">
          {reportByOrganizer.size === 0 ? (
            <p className="text-muted text-center py-10">{t("admin.noTransactions")}</p>
          ) : (
            [...reportByOrganizer.entries()].map(([email, report]) => {
              const bal = organizerBalances.find((b) => b.email === email);
              const pending = report.totalFees - report.totalDeposits;
              return (
                <div key={email} className="bg-surface border border-border rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium text-lg">{email}</p>
                    <div className="text-right">
                      <p className="text-sm text-muted">{t("admin.currentBalance")}</p>
                      <p className={`text-xl font-bold ${
                        (bal?.balance || 0) < 0 ? "text-danger" : "text-success"
                      }`}>
                        ${bal?.balance?.toFixed(2) || "0.00"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div className="bg-danger/5 rounded-lg p-3">
                      <p className="text-xs text-muted">{t("admin.totalFees")}</p>
                      <p className="text-lg font-bold text-danger">${report.totalFees.toFixed(2)}</p>
                    </div>
                    <div className="bg-success/5 rounded-lg p-3">
                      <p className="text-xs text-muted">{t("admin.totalDeposits")}</p>
                      <p className="text-lg font-bold text-success">${report.totalDeposits.toFixed(2)}</p>
                    </div>
                    <div className={`rounded-lg p-3 ${pending > 0 ? "bg-danger/5" : "bg-success/5"}`}>
                      <p className="text-xs text-muted">{t("admin.pendingDebt")}</p>
                      <p className={`text-lg font-bold ${pending > 0 ? "text-danger" : "text-success"}`}>
                        ${pending > 0 ? pending.toFixed(2) : "0.00"}
                      </p>
                    </div>
                  </div>
                  {report.concerts.size > 0 && (
                    <div className="border-t border-border pt-3">
                      <p className="text-xs text-muted mb-2">Fees por evento:</p>
                      <div className="space-y-1">
                        {[...report.concerts.entries()].map(([cId, amount]) => (
                          <div key={cId} className="flex justify-between text-sm">
                            <span>{concertNameMap.get(cId) || cId}</span>
                            <span className="font-medium text-danger">${amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "balances" && <>
      {/* Credit Account Form */}
      <div className="bg-surface border border-border rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">{t("admin.creditAccount")}</h2>
        <form onSubmit={handleCredit} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1.5">
              {t("admin.organizerEmail")}
            </label>
            <select
              value={creditEmail}
              onChange={(e) => setCreditEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
            >
              <option value="">--</option>
              {organizerEmails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-sm font-medium mb-1.5">
              {t("admin.amount")} (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
              placeholder="0.00"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium mb-1.5">
              {t("admin.note")}
            </label>
            <input
              type="text"
              value={creditNote}
              onChange={(e) => setCreditNote(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
              placeholder="e.g. Zelle deposit"
            />
          </div>
          <button
            type="submit"
            disabled={crediting || !creditEmail || !creditAmount}
            className="px-6 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {crediting ? "..." : t("admin.creditAccount")}
          </button>
        </form>
      </div>

      {/* Organizer Balances List */}
      {organizerBalances.length === 0 ? (
        <p className="text-muted text-center py-10">{t("admin.noOrganizers")}</p>
      ) : (
        <div className="space-y-4">
          {organizerBalances
            .sort((a, b) => a.email.localeCompare(b.email))
            .map((bal) => {
              const isExpanded = expandedEmail === bal.email;
              const orgConcerts = concerts.filter(
                (c) => c.organizerEmail.toLowerCase() === bal.email,
              );
              return (
                <div
                  key={bal.id}
                  className="bg-surface border border-border rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedEmail(isExpanded ? null : bal.email)
                    }
                    className="w-full p-4 flex items-center justify-between hover:bg-background/50 transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium">{bal.email}</p>
                      <p className="text-sm text-muted">
                        {orgConcerts.length} {orgConcerts.length === 1 ? "evento" : "eventos"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-2xl font-bold ${
                          bal.balance <= 0
                            ? "text-danger"
                            : bal.balance < 10
                              ? "text-warning"
                              : "text-success"
                        }`}
                      >
                        ${bal.balance.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted">{bal.currency}</p>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border p-4">
                      <h3 className="text-sm font-semibold mb-3 text-muted">
                        {t("admin.transactionHistory")}
                      </h3>
                      {(!bal.transactions || bal.transactions.length === 0) ? (
                        <p className="text-sm text-muted">
                          {t("admin.noTransactions")}
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {bal.transactions.map((txn) => (
                            <div
                              key={txn.id}
                              className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0"
                            >
                              <div>
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                                    txn.type === "deposit"
                                      ? "bg-success/10 text-success"
                                      : txn.type === "fee"
                                        ? "bg-danger/10 text-danger"
                                        : txn.type === "refund"
                                          ? "bg-accent/10 text-accent"
                                          : "bg-muted/10 text-muted"
                                  }`}
                                >
                                  {t(`admin.${txn.type}`) || txn.type}
                                </span>
                                <span className="text-muted">
                                  {txn.description}
                                </span>
                              </div>
                              <div className="text-right whitespace-nowrap">
                                <span
                                  className={`font-medium ${
                                    txn.amount >= 0
                                      ? "text-success"
                                      : "text-danger"
                                  }`}
                                >
                                  {txn.amount >= 0 ? "+" : ""}$
                                  {Math.abs(txn.amount).toFixed(2)}
                                </span>
                                <p className="text-xs text-muted">
                                  {new Date(txn.createdAt).toLocaleDateString()}{" "}
                                  {new Date(txn.createdAt).toLocaleTimeString(
                                    [],
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
      </>}
    </div>
  );
}
