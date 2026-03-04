"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero header */}
      <header className="bg-accent text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-2xl font-bold tracking-wide">
            m<span className="text-white/80">Tickets</span>
          </span>
          <Link
            href="/admin"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            Admin
          </Link>
        </div>
      </header>

      {/* Hero section */}
      <div className="bg-gradient-to-br from-accent via-accent-dark to-accent-light text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24 sm:py-32 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 tracking-tight">
            Your Event, Your Tickets
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-10">
            Use the event link shared with you to view event details and
            purchase your tickets securely.
          </p>
          <Link
            href="/admin"
            className="inline-block px-8 py-3.5 bg-white text-accent font-semibold rounded-lg hover:bg-white/90 transition-colors shadow-lg"
          >
            Event Organizer? Log In
          </Link>
        </div>
      </div>

      {/* Features section */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            How It Works
          </h2>
          <p className="text-muted text-center mb-12 max-w-xl mx-auto">
            A simple, secure process from purchase to entry
          </p>

          <div className="grid sm:grid-cols-3 gap-8">
            <div className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-accent font-bold">1</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Get Your Link</h3>
              <p className="text-muted text-sm">
                Receive the event link from the organizer and browse available tickets.
              </p>
            </div>

            <div className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-accent font-bold">2</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Purchase & Pay</h3>
              <p className="text-muted text-sm">
                Fill in attendee details, choose your payment method, and upload your proof.
              </p>
            </div>

            <div className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-accent font-bold">3</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Get Your QR Code</h3>
              <p className="text-muted text-sm">
                Once approved, your digital ticket with QR code is ready. Show it at the entrance.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-accent text-white/60 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-sm">
          <p className="font-semibold text-white mb-1">mTickets</p>
          <p>Professional event ticketing platform</p>
        </div>
      </footer>
    </div>
  );
}
