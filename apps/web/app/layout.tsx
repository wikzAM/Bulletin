import type { ReactNode } from "react";

export const metadata = {
  title: "Bulletin",
  description: "Turn a goal into a plan, and a plan into checked work.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem" }}>{children}</body>
    </html>
  );
}
