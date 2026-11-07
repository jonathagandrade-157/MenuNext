import { describe, expect, it } from "vitest";
import { buildInviteEmail, escapeHtml } from "./inviteEmail";

const URL_OK = "https://menunext.example/convite/abc123";

describe("buildInviteEmail", () => {
  it("monta assunto, texto e HTML com o link do convite", () => {
    const mail = buildInviteEmail({ to: "equipe@exemplo.test", restaurantName: "Burger do Zé", inviteUrl: URL_OK })!;
    expect(mail.to).toBe("equipe@exemplo.test");
    expect(mail.subject).toBe("Convite para a equipe de Burger do Zé no MenuNext");
    expect(mail.text).toContain(URL_OK);
    expect(mail.html).toContain(`href="${URL_OK}"`);
    expect(mail.text).toMatch(/expira em 7 dias/);
  });

  it("escapa HTML no nome da loja e não deixa quebra de linha no assunto", () => {
    const mail = buildInviteEmail({ to: "a@b.co", restaurantName: '<img src=x onerror=alert(1)>\nBcc: x@y.zz', inviteUrl: URL_OK })!;
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it("recusa link com esquema perigoso ou inválido", () => {
    for (const inviteUrl of ["javascript:alert(1)", "data:text/html,x", "ftp://x.test/a", "não é url", ""]) {
      expect(buildInviteEmail({ to: "a@b.co", restaurantName: "Loja", inviteUrl }), inviteUrl).toBeNull();
    }
  });

  it("usa um nome padrão quando a loja não tem nome", () => {
    expect(buildInviteEmail({ to: "a@b.co", restaurantName: "  ", inviteUrl: URL_OK })!.subject).toContain("uma loja");
  });
});

describe("escapeHtml", () => {
  it("escapa os cinco caracteres perigosos", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
