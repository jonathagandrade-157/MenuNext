import { describe, expect, it } from "vitest";
import { buildStoreUrl } from "./site-url";

describe("buildStoreUrl", () => {
  it("sempre usa o prefixo /loja/ — mesma rota real da loja pública", () => {
    expect(buildStoreUrl("https://menunext.com.br", "menunext-teste")).toBe("https://menunext.com.br/loja/menunext-teste");
  });

  it("funciona com qualquer origem (preview da Vercel, domínio próprio, localhost)", () => {
    expect(buildStoreUrl("https://menunext-git-main.vercel.app", "restaurante-x")).toBe(
      "https://menunext-git-main.vercel.app/loja/restaurante-x"
    );
    expect(buildStoreUrl("http://localhost:3000", "restaurante-x")).toBe("http://localhost:3000/loja/restaurante-x");
  });

  it("remove barra final da origem para nunca gerar // duplicado", () => {
    expect(buildStoreUrl("https://menunext.com.br/", "loja-x")).toBe("https://menunext.com.br/loja/loja-x");
  });
});
