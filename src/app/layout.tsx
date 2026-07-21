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
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "SafeEPI Gestão | SESMT Digital",
  description: "Sistema de Controle de EPI - SafeEPI",
};

import { AuthProvider } from "@/contexts/AuthContext";
import { ClientShell } from "@/components/layout/ClientShell";
import { Toaster } from "sonner";
import { ToastIcon } from "@/components/ui/ToastIcon";
import { Analytics } from "@vercel/analytics/next";

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
      <body className="min-h-[100dvh] overflow-x-hidden flex flex-col bg-slate-50 text-slate-900">
        <a href="#main-content" className="skip-link">Pular para o conteúdo principal</a>
        <AuthProvider>
          <ClientShell>
            {children}
          </ClientShell>
        </AuthProvider>
        <Toaster
          position="bottom-right"
          closeButton
          visibleToasts={4}
          gap={12}
          toastOptions={{ duration: 4500 }}
          icons={{
            success: <ToastIcon type="success" />,
            error: <ToastIcon type="error" />,
            warning: <ToastIcon type="warning" />,
            info: <ToastIcon type="info" />,
          }}
        />
        <Analytics />
      </body>
    </html>
  );
}
