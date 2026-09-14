/**
 * URL pública da loja (Sprint 4 — "Minha loja"/compartilhamento) — NUNCA um
 * novo formato: sempre `/loja/{slug}` (rota real, src/app/loja/[slug]),
 * nunca o domínio hardcoded "menunext.com.br" usado em telas antigas (ver
 * auditoria: esse domínio nem está confirmado como conectado ao projeto, e
 * as telas que o usam esquecem o prefixo /loja/, gerando um link que não
 * abre a loja). A única fonte confiável do endereço público hoje é a
 * própria requisição recebida — funciona em qualquer ambiente (preview da
 * Vercel, domínio próprio quando for conectado, localhost em dev) sem
 * depender de nenhuma variável de ambiente nova.
 */

import { headers } from "next/headers";

export function buildStoreUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/loja/${slug}`;
}

export async function getRequestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function getStoreUrl(slug: string): Promise<string> {
  const origin = await getRequestOrigin();
  return buildStoreUrl(origin, slug);
}
