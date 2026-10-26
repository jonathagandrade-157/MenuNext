import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { connection } from "next/server";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // O nonce da CSP é novo a cada requisição (gerado em src/proxy.ts) e o Next só consegue aplicá-lo ao renderizar
  // sob demanda. Por isso TODA página é dinâmica; sem isto, uma página estática sairia com scripts sem nonce e
  // o navegador os bloquearia.
  await connection();
  return (
    <html lang="pt-BR" className={`${plusJakartaSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-surface text-graphite font-sans">
        {children}
      </body>
    </html>
  );
}
