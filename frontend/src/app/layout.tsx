import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodePulse — Your Coding Life, Unified.",
  description:
    "CodePulse is a unified competitive programming analytics platform. Connect profiles, track streaks, and compare ratings in one dashboard.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
