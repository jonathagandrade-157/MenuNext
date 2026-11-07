import { describe, expect, it } from "vitest";
import { getAdminTickets, getMerchantTickets, friendlySupportError, isTicketId, validateMessageBody, validateNewTicket } from "./support";
import { isMissingRpc } from "./rpcErrors";

describe("validateNewTicket", () => {
  it("aceita e normaliza", () => {
    expect(validateNewTicket("  Pix não aparece ", " texto ", "high")).toEqual({ ok: true, value: { subject: "Pix não aparece", body: "texto", priority: "high" } });
  });
  it("recusa assunto curto/longo, corpo vazio/longo e prioridade que o lojista não pode usar", () => {
    for (const [s, b, p] of [["ab", "x", "low"], ["x".repeat(121), "x", "low"], ["assunto", " ", "low"], ["assunto", "x".repeat(4001), "low"], ["assunto", "x", "urgent"], ["assunto", "x", "banana"], ["assunto", "x", undefined]] as const) {
      expect(validateNewTicket(s, b, p).ok, `${s.length}/${b.length}/${p}`).toBe(false);
    }
  });
});

describe("outros validadores", () => {
  it("mensagem", () => {
    expect(validateMessageBody(" oi ")).toEqual({ ok: true, value: "oi" });
    expect(validateMessageBody("").ok).toBe(false);
    expect(validateMessageBody(null).ok).toBe(false);
    expect(validateMessageBody("x".repeat(4001)).ok).toBe(false);
  });
  it("id de chamado é UUID", () => {
    expect(isTicketId("0b0e7c8e-7a47-4bd5-9f55-5f2d6a0f3c11")).toBe(true);
    expect(isTicketId("1 or 1=1")).toBe(false);
  });
  it("erros do banco viram mensagens amigáveis", () => {
    expect(friendlySupportError("too_many_open")).toMatch(/10 chamados/);
    expect(friendlySupportError("ticket_closed")).toMatch(/encerrado/);
    expect(friendlySupportError("relation x does not exist")).toBe("Não foi possível concluir agora. Tente novamente.");
  });
});

describe("recurso indisponível sem a migration", () => {
  it("isMissingRpc", () => {
    expect(isMissingRpc({ code: "PGRST202" })).toBe(true);
    expect(isMissingRpc({ code: "PGRST205" })).toBe(true);
    expect(isMissingRpc({ message: 'relation "public.support_tickets" does not exist' })).toBe(true);
    expect(isMissingRpc({ code: "42501", message: "permission denied" })).toBe(false);
  });
  it("leitores devolvem available=false em vez de lançar", async () => {
    const tableMissing = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: "PGRST205", message: "x" } }) }) }) }) }) } as never;
    expect(await getMerchantTickets(tableMissing, "r")).toEqual({ available: false, tickets: [] });
    const rpcMissing = { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "x" } }) } as never;
    expect(await getAdminTickets(rpcMissing, null)).toEqual({ available: false, tickets: [] });
    const boom = { rpc: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) } as never;
    await expect(getAdminTickets(boom, null)).rejects.toBeTruthy();
  });
});
