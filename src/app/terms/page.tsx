import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms and Conditions | maTickets",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">Terms and Conditions</h1>

        <div className="space-y-6 text-foreground/80 leading-relaxed">
          <p className="text-muted text-sm">Last updated: March 2025</p>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">1. Ticket Purchases</h2>
            <p>
              All ticket purchases made through maTickets are subject to
              approval by the event organizer. Submitting a purchase request
              does not guarantee a ticket. You will receive confirmation once
              your order has been reviewed and approved.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">2. Payment</h2>
            <p>
              Payment must be completed according to the instructions provided
              during checkout. Proof of payment may be required. Orders that
              are not paid within the specified timeframe may be cancelled
              automatically.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">3. Refund Policy</h2>
            <p>
              Once a ticket order has been approved, no refunds will be issued.
              If your order is rejected by the event organizer, any payment
              made will be refunded through the original payment method.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">4. Ticket Usage</h2>
            <p>
              Each ticket is valid for a single entry to the specified event.
              Tickets are non-transferable unless explicitly permitted by the
              event organizer. Duplicate or fraudulent tickets will be voided
              without refund.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">5. Event Changes</h2>
            <p>
              Event details including date, time, venue, and lineup are subject
              to change at the discretion of the event organizer. maTickets is
              not responsible for changes made by event organizers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">6. User Conduct</h2>
            <p>
              You agree to provide accurate personal information when
              purchasing tickets. Any false or misleading information may
              result in order cancellation. You are responsible for maintaining
              the confidentiality of your ticket and order information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">7. Limitation of Liability</h2>
            <p>
              maTickets acts as a ticketing platform for event organizers. We
              are not responsible for the event itself, including but not
              limited to cancellations, changes, or the quality of the event
              experience. Our liability is limited to the ticket purchase price.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">8. Changes to Terms</h2>
            <p>
              We reserve the right to update these terms at any time.
              Continued use of the platform after changes constitutes
              acceptance of the updated terms.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border">
          <Link
            href="/"
            className="text-accent-light hover:text-accent transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
