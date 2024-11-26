import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Nav from '@/components/Nav'
import { Toaster } from 'sonner'

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Audibloom Test",
  description: "Audibloom",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-geist-sans)]">
        <Nav />
        <main className="p-8">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  )
}
