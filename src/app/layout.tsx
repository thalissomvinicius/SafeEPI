import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "SafeEPI | SESMT Digital",
  description: "Sistema de Controle de EPI - SafeEPI",
};

import { AuthProvider } from "@/contexts/AuthContext";
import { ClientShell } from "@/components/layout/ClientShell";
import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${plusJakarta.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        <AuthProvider>
          <ClientShell>
            {children}
          </ClientShell>
        </AuthProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
