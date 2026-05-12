// The actual <html> and <body> live in src/app/[locale]/layout.tsx so the
// `lang` attribute matches the active locale. This root layout exists only
// because Next.js requires an app/layout.tsx; it just passes through.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
