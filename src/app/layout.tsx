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
          {/* The bar never fit a phone — the tagline alone pushed past 375px, and
              each nav item made it worse. The wordmark and links stay; the
              decorative parts give way first. */}
          <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 sm:gap-6">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <span className="text-up font-bold tracking-tight">▮▮</span>
              <span className="font-bold tracking-tight">FundFlow</span>
              <span className="text-muted hidden text-xs sm:inline">INTELLIGENCE</span>
            </Link>
            <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto text-xs">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="shrink-0 rounded px-3 py-1.5 text-muted hover:bg-panel2 hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto hidden shrink-0 text-[10px] text-muted lg:block">
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
