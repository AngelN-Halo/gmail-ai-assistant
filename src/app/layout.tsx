import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gmail AI Assistant",
  description: "Sort, classify, and draft replies to your Gmail inbox with AI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 font-sans">
        {children}
      </body>
    </html>
  );
}
