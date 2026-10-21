import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Collector" };

/** Fonts come from Google Fonts with the old page's exact link: the full files carry the arrows (← →) the page uses,
 * which next/font's latin subset leaves to a fallback font. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Code+Pro:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body id="top">{children}</body>
    </html>
  );
}
