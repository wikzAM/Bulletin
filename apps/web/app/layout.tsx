import type { ReactNode } from "react";
import Link from "next/link";
import { copy } from "../lib/copy";
import "./globals.css";

export const metadata = {
  title: copy.appName,
  description: copy.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#content" className="skip-link">
          {copy.skipToContent}
        </a>
        <header className="shell-header">
          <Link href="/" className="brand">
            {copy.appName}
          </Link>
          <span className="tagline">{copy.tagline}</span>
          <nav aria-label={copy.nav.label} className="shell-nav">
            <Link href="/">{copy.nav.projects}</Link>
            <Link href="/questions">{copy.nav.questions}</Link>
            <Link href="/new">{copy.nav.newProject}</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
