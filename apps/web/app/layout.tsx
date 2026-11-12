import type { Metadata } from "next";
import { Newsreader, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LedgerProvider } from "@/lib/store";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Toasts } from "@/components/Toasts";

const display = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"], display: "swap" });
const ui = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Endorse: the invoice is the account",
  description:
    "Endorse turns an invoice into a NEAR account. The client pays it from any chain, the issuer can sell it for cash today, and whoever owns it when it is paid collects.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: { title: "Endorse", description: "The invoice is the account.", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <LedgerProvider>
          <Header />
          <main>{children}</main>
          <Footer />
          <Toasts />
        </LedgerProvider>
      </body>
    </html>
  );
}
