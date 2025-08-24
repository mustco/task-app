import type React from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "ListKu",
  description: "Manage your notes with automated reminders",
  icons: { icon: "/icon-listku.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Pakai value inter.className, bukan string literal */}
      <body className={`${inter.className} antialiased`}>
        {/* BACKGROUND LAYER: berdiri sendiri, ga ngaruh layout konten */}
        <div className="fixed inset-0 -z-10 pointer-events-none">
          <div className="pointer-events-none absolute -inset-20 -z-10 blobs">
            <div className="absolute left-[10%] top-[15%] h-64 w-64 rounded-full bg-fuchsia-500/25 animate-blob" />
            <div className="absolute right-[15%] top-[10%] h-72 w-72 rounded-full bg-sky-400/25 animate-blob [animation-delay:4s]" />
            <div className="absolute left-[20%] bottom-[10%] h-80 w-80 rounded-full bg-emerald-400/20 animate-blob [animation-delay:8s]" />
          </div>
        </div>

        {children}
        <Toaster />
      </body>
    </html>
  );
}
