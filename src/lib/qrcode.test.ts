import { describe, expect, it } from "vitest";
import { generateStoreQrCodeDataUrl } from "./qrcode";

describe("generateStoreQrCodeDataUrl", () => {
  it("gera um data URL de imagem PNG a partir da URL da loja", async () => {
    const dataUrl = await generateStoreQrCodeDataUrl("https://menunext.com.br/loja/menunext-teste");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it("URLs diferentes geram QR Codes diferentes", async () => {
    const a = await generateStoreQrCodeDataUrl("https://menunext.com.br/loja/loja-a");
    const b = await generateStoreQrCodeDataUrl("https://menunext.com.br/loja/loja-b");
    expect(a).not.toBe(b);
  });
});
