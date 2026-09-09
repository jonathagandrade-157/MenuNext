import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "MenuNext — Seu restaurante. Sua loja. Seus pedidos.",
  description:
    "MenuNext é a plataforma que permite ao seu restaurante ter sua própria loja online, receber pedidos e administrar a operação.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${plusJakartaSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-surface text-graphite font-sans">
        {children}
      </body>
    </html>
  );
}
