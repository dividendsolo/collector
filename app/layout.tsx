import type { Metadata } from "next";
import "./globals.css";
// The Card flow page's drawing is React Flow (collector#51); its stylesheet is loaded once, with the page's own.
import "@xyflow/react/dist/style.css";

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
        {/* A page a new build brought back starts hidden, before its first paint, so the fade-in has no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem("collector.fade-in")==="1")document.documentElement.classList.add("fading-in")}catch(e){}`,
          }}
        />
      </head>
      <body id="top">{children}</body>
    </html>
  );
}
