import type { Metadata } from "next";
import { VT323, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const vt323 = VT323({
  weight: "400",
  variable: "--font-display",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-body",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "agent-trace ⚡ Zero-instrumentation LLM Agent Tracer & Cost Tracker",
  description: "Zero-instrumentation, terminal-native LLM agent tracer & cost tracker. Like `time` but for AI agents. Built from raw math and socket interception.",
  keywords: ["llm", "agent", "trace", "cost tracker", "openai", "anthropic", "langchain", "cli", "python", "typescript"],
  authors: [{ name: "Ronak Rahane" }],
  openGraph: {
    title: "agent-trace ⚡ Terminal-Native LLM Agent Tracer",
    description: "Zero-instrumentation LLM agent tracer & cost tracker. Like `time` but for AI agents.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${vt323.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} dark h-full antialiased selection:bg-blue-500/30 selection:text-blue-200`}
    >
      <body className="min-h-full flex flex-col bg-[#0b0c10] text-[#f1f5f9] font-mono">
        {children}
      </body>
    </html>
  );
}
