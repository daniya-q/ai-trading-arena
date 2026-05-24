import type { Metadata } from "next";

import "./globals.css";

import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "AI Trading Arena",
  description: "Autonomous AI trading platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">

      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>

      <body>

        <main className="min-h-screen bg-[#050505] text-white flex">

          <Sidebar />

          <div className="flex-1">
            {children}
          </div>

        </main>

      </body>

    </html>
  );
}
