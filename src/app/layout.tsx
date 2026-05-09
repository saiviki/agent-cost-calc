import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Cost Calculator",
  description:
    "Model the real cost of running an AI agent — input tokens, output tokens, tool calls, caching, and volume. Compare across top models.",
  openGraph: {
    title: "Agent Cost Calculator",
    description:
      "Model the real cost of running an AI agent — input tokens, output tokens, tool calls, caching, and volume. Compare across top models.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
