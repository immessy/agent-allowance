import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Allowance",
  description: "Deterministic spending guardrails for AI shopping agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}

