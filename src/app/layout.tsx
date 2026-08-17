import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FundFlow Intelligence",
  description: "Mutual fund portfolio intelligence — institutional buy/sell signals",
};

const NAV = [
  { href: "/", label: "TERMINAL" },
  { href: "/rankings", label: "RANKINGS" },
  { href: "/upload", label: "UPLOAD" },
  { href: "/runs", label: "RUNS" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-edge bg-panel">
          <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 py-2.5">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-up font-bold tracking-tight">▮▮</span>
              <span className="font-bold tracking-tight">FundFlow</span>
              <span className="text-muted text-xs">INTELLIGENCE</span>
            </Link>
            <nav className="flex gap-1 text-xs">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded px-3 py-1.5 text-muted hover:bg-panel2 hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto text-[10px] text-muted">
              INSTITUTIONAL ACTIVITY MONITOR
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5">
          {children}
        </main>
        <footer className="border-t border-edge px-4 py-2 text-center text-[10px] text-muted">
          FundFlow Intelligence · data is illustrative · not investment advice
        </footer>
      </body>
    </html>
  );
}
