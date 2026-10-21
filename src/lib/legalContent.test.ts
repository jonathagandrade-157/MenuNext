import { describe, expect, it } from "vitest";
import { PRIVACY_INTRO, PRIVACY_SECTIONS, TERMS_SECTIONS, type LegalSection } from "./legalContent";

function check(sections: LegalSection[]) {
  const ids = sections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const s of sections) {
    const hasContent = (s.paragraphs?.length ?? 0) + (s.bullets?.length ?? 0) + (s.after?.length ?? 0) > 0;
    expect(hasContent, `seção ${s.id} sem conteúdo`).toBe(true);
  }
}

describe("textos legais", () => {
  it("política de privacidade: ids únicos, seções com conteúdo e bloco de contato", () => {
    check(PRIVACY_SECTIONS);
    expect(PRIVACY_SECTIONS.some((s) => s.id === "contato")).toBe(true);
    expect(PRIVACY_SECTIONS.some((s) => s.id === "seguranca")).toBe(true); // o rodapé linka #seguranca
  });

  it("termos de uso: ids únicos, seções com conteúdo e bloco de contato", () => {
    check(TERMS_SECTIONS);
    expect(TERMS_SECTIONS.some((s) => s.id === "contato")).toBe(true);
  });

  it("cita a lei e os direitos do titular, e nunca promete algo que o produto não faz", () => {
    const privacy = JSON.stringify([PRIVACY_INTRO, PRIVACY_SECTIONS]);
    expect(privacy).toContain("13.709");
    expect(privacy).toContain("art. 18");
    // o sistema não guarda cartão nem faz anúncios: o texto não pode dizer o contrário
    expect(privacy).toContain("Não armazenamos número de cartão");
    expect(privacy).toContain("Não vendemos dados pessoais");
  });
});
