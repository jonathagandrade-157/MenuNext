import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, sendEmail } from "./email";

const ENV = { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "MenuNext <convites@exemplo.test>" };
const MSG = { to: "equipe@exemplo.test", subject: "Convite", html: "<p>oi</p>", text: "oi" };

afterEach(() => vi.unstubAllGlobals());

describe("isEmailConfigured", () => {
  it("exige chave E remetente", () => {
    expect(isEmailConfigured(ENV)).toBe(true);
    expect(isEmailConfigured({ RESEND_API_KEY: "x" })).toBe(false);
    expect(isEmailConfigured({ EMAIL_FROM: "a@b.co" })).toBe(false);
    expect(isEmailConfigured({ RESEND_API_KEY: "  ", EMAIL_FROM: "a@b.co" })).toBe(false);
    expect(isEmailConfigured({})).toBe(false);
  });
});

describe("sendEmail", () => {
  it("sem configuração não chama a rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendEmail(MSG, {})).toEqual({ ok: false, reason: "not_configured" });
    expect(await sendEmail(MSG, { RESEND_API_KEY: "x" })).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia ao Resend com a chave só no cabeçalho e um único destinatário", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendEmail(MSG, ENV)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: ENV.EMAIL_FROM, to: ["equipe@exemplo.test"], subject: "Convite" });
    expect(init.body).not.toContain("re_test_key");
  });

  it("recusa destinatário malformado ou com vários endereços, e assunto com quebra de linha — sem rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const to of ["", "sem-arroba", "a@b", "a@b.co, c@d.co", "a@b.co\nbcc:x@y.zz", "<a@b.co>"]) {
      expect(await sendEmail({ ...MSG, to }, ENV), to).toEqual({ ok: false, reason: "invalid_recipient" });
    }
    expect(await sendEmail({ ...MSG, subject: "oi\nBcc: x@y.zz" }, ENV)).toEqual({ ok: false, reason: "invalid_recipient" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifica a resposta do provedor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    expect(await sendEmail(MSG, ENV)).toEqual({ ok: false, reason: "rejected" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await sendEmail(MSG, ENV)).toEqual({ ok: false, reason: "unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await sendEmail(MSG, ENV)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("erro de rede ou tempo esgotado vira indisponível, sem lançar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND api.resend.com")));
    expect(await sendEmail(MSG, ENV)).toEqual({ ok: false, reason: "unavailable" });
  });
});
