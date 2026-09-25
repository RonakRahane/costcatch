import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// site.css reads this font through the --font-mono variable.
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "costcatch — see what your AI agent did and what it cost",
  description:
    "Put costcatch in front of the command that runs your agent. See every LLM call it makes, what each call cost, and what went wrong. No code changes. Runs on your machine.",
  keywords: [
    "costcatch",
    "llm tracer",
    "ai agent debugging",
    "ai agent cost",
    "token cost tracker",
    "cli dev tool",
    "python",
    "node.js",
    "openai cost",
    "anthropic cost",
  ],
  authors: [{ name: "Ronak Rahane" }],
  openGraph: {
    title: "costcatch — see what your AI agent did and what it cost",
    description:
      "Every LLM call your agent makes, what it cost, and what went wrong. One command, no code changes, nothing leaves your machine.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={mono.variable}>
      <body>{children}</body>
    </html>
  );
}
