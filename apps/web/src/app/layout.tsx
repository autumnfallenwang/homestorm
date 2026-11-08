import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: "Homestorm",
  description: "Brainstorm with several AI models at once. You chair the meeting.",
  icons: [{ rel: "icon", url: "/icon.svg", type: "image/svg+xml" }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The appearance script sets classes on <html> before React loads (ADR 0018), so they differ from the server's.
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string from our own code, no user data. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="overflow-hidden antialiased" style={{ height: "100dvh" }}>
        <ThemeProvider />
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
