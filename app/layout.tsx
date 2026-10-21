import type { Metadata } from "next";
import { Inter, Source_Code_Pro } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });
const mono = Source_Code_Pro({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-source-code-pro" });

export const metadata: Metadata = { title: "Collector" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable}`}>
      <body id="top">{children}</body>
    </html>
  );
}
