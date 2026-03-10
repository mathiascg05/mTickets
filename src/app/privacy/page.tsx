import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | maTickets",
};

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>

        <div className="space-y-6 text-foreground/80 leading-relaxed">
          <p className="text-muted text-sm">Last updated: March 2025</p>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">1. Information We Collect</h2>
            <p>
              When you purchase a ticket, we collect the following personal
              information: your first and last name, email address, and
              national identification number (cedula). This information is
              required to process your ticket order and verify your identity
              at the event.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">2. How We Use Your Information</h2>
            <p>We use your personal information to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Process and manage your ticket orders</li>
              <li>Send you ticket confirmations and event updates via email</li>
              <li>Verify your identity at event entry</li>
              <li>Communicate with you about your purchases</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">3. Payment Information</h2>
            <p>
              Payment proof (such as screenshots or reference numbers) is
              collected solely for order verification by the event organizer.
              We do not store credit card numbers or banking credentials.
              Payment proof is only accessible to event administrators.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">4. Data Sharing</h2>
            <p>
              Your personal information is shared only with the event
              organizer for the purpose of ticket verification and event
              management. We do not sell, rent, or share your personal
              information with third parties for marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">5. Data Security</h2>
            <p>
              We implement appropriate security measures to protect your
              personal information, including encrypted connections (HTTPS),
              access controls, and field-level permissions that restrict
              sensitive data visibility to authorized administrators only.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">6. Data Retention</h2>
            <p>
              Your personal information is retained for as long as necessary
              to fulfill the purposes described in this policy, including
              post-event record-keeping. You may request deletion of your
              data by contacting the event organizer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">7. Your Rights</h2>
            <p>
              You have the right to access, correct, or request deletion of
              your personal data. To exercise these rights, please contact
              the event organizer directly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2 text-foreground">8. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. Any changes
              will be reflected on this page with an updated revision date.
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
