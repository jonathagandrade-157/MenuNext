import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regressão de PROMESSAS nas páginas públicas. O MenuNext mostra a chave Pix e o "Copia e Cola" do restaurante,
 * mas NÃO confirma o recebimento do Pix do pedido (o pedido não tem status de pagamento; o lojista confere no
 * banco). Estas verificações impedem que o texto volte a prometer confirmação/automação de Pix ou recursos que
 * não existem (e-mail do cliente, "pratos favoritos").
 */
const SRC = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const PUBLIC_FILES = [
  "app/page.tsx",
  "components/marketing/SiteHeader.tsx",
  "components/marketing/SiteFooter.tsx",
  "lib/legalContent.ts",
  "app/cadastro/page.tsx",
  "components/cadastro/CadastroForm.tsx",
];

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /pix\s+autom[aá]tic/i, why: "promete Pix automático" },
  { pattern: /pix\s+confirmad/i, why: "promete Pix confirmado" },
  { pattern: /confirmad[oa]s?\s+instant/i, why: "promete confirmação instantânea" },
  { pattern: /instant[aâ]ne/i, why: "promete algo instantâneo" },
  { pattern: /confirma[çc][aã]o\s+autom[aá]tica/i, why: "promete confirmação automática" },
  { pattern: /baixa\s+autom[aá]tica/i, why: "promete baixa automática" },
  { pattern: /e-mails?\s+para\s+(fazer\s+)?remarketing/i, why: "o checkout não coleta e-mail do cliente" },
  { pattern: /pratos\s+favoritos/i, why: "não existe pratos favoritos no painel" },
];

describe("promessas das páginas públicas", () => {
  for (const file of PUBLIC_FILES) {
    it(`${file} não promete o que o produto não entrega`, () => {
      const source = read(file);
      for (const { pattern, why } of FORBIDDEN) {
        expect(source, `${file}: ${why}`).not.toMatch(pattern);
      }
    });
  }

  it("a landing diz com clareza que o MenuNext não confirma o Pix e que o lojista confere no banco", () => {
    const page = read("app/page.tsx");
    expect(page).toMatch(/não[^.]{0,80}confirma[^.]{0,60}recebimento/i);
    expect(page).toMatch(/confere[^.]{0,30}no seu banco/i);
  });

  it("a landing mantém a proposta de valor (0% de comissão, Pix direto na chave, 30 dias grátis)", () => {
    const page = read("app/page.tsx");
    expect(page).toMatch(/0% de comissão/i);
    expect(page).toMatch(/Pix direto na sua chave/i);
    expect(page).toMatch(/30 dias/i);
  });

  it("os termos continuam dizendo que o MenuNext não processa os pagamentos dos pedidos", () => {
    expect(read("lib/legalContent.ts")).toMatch(/não processa, retém nem repassa/i);
  });

  it("a loja pública não afirma que o pagamento foi confirmado", () => {
    const files = ["components/loja/CheckoutClient.tsx", "app/loja/[slug]/pedido/[orderId]/page.tsx"];
    for (const file of files) {
      expect(read(file), file).not.toMatch(/pagamento\s+(confirmado|aprovado|recebido)/i);
    }
  });
});
