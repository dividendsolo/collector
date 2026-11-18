import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@xyflow/react/dist/style.css";

export const metadata: Metadata = { title: "Collector" };

export const viewport: Viewport = {
  themeColor: "#131415",
  colorScheme: "dark",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Code+Pro:wght@400;500&display=swap"
          rel="stylesheet"
        />
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
