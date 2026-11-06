import { describe, expect, it } from "vitest";
import { evaluateMasterNetwork, ipInList, isMasterPath, masterMfaRequired, parseIpList } from "./masterAccess";

describe("isMasterPath", () => {
  it("cobre o Master e a tela de segundo fator, nada além", () => {
    for (const p of ["/master", "/master/", "/master/usuarios", "/master-mfa"]) expect(isMasterPath(p), p).toBe(true);
    for (const p of ["/masters", "/masterplan", "/painel/master", "/loja/master", "/", "/master-mfa/x"]) expect(isMasterPath(p), p).toBe(false);
  });
});

describe("parseIpList", () => {
  it("aceita IPv4, CIDR e IPv6; descarta lixo", () => {
    expect(parseIpList(" 203.0.113.7 , 198.51.100.0/24, 2001:db8::1, abc, 1.2.3.4/33, 300.1.1.1, 1.2.3.4/8/9, , ")).toEqual(["203.0.113.7", "198.51.100.0/24", "2001:db8::1"]);
    expect(parseIpList(undefined)).toEqual([]);
  });
});

describe("ipInList", () => {
  const list = parseIpList("203.0.113.7,198.51.100.0/24,10.0.0.0/8,2001:db8::1,0.0.0.0/32");
  it("IP exato, faixa e IPv6", () => {
    expect(ipInList("203.0.113.7", list)).toBe(true);
    expect(ipInList("198.51.100.250", list)).toBe(true);
    expect(ipInList("198.51.101.1", list)).toBe(false);
    expect(ipInList("10.200.1.1", list)).toBe(true);
    expect(ipInList("2001:DB8::1", list)).toBe(true);
    expect(ipInList("203.0.113.8", list)).toBe(false);
  });
  it("desconhecido e vazio nunca passam", () => {
    expect(ipInList("unknown", list)).toBe(false);
    expect(ipInList("", list)).toBe(false);
    expect(ipInList("unknown", ["0.0.0.0/0"])).toBe(false);
  });
  it("/0 libera todo IPv4, /32 só o próprio", () => {
    expect(ipInList("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
    expect(ipInList("8.8.8.8", ["8.8.8.8/32"])).toBe(true);
    expect(ipInList("8.8.8.9", ["8.8.8.8/32"])).toBe(false);
  });
});

describe("evaluateMasterNetwork", () => {
  it("sem configuração: libera (comportamento atual)", () => {
    expect(evaluateMasterNetwork({ host: "qualquer.com", ip: "1.1.1.1" }, {})).toEqual({ allowed: true });
    expect(evaluateMasterNetwork({ host: "x", ip: "unknown" }, { MASTER_HOST: "  ", MASTER_ALLOWED_IPS: "" })).toEqual({ allowed: true });
  });
  it("MASTER_HOST: só o domínio configurado (sem diferenciar caixa nem porta)", () => {
    const env = { MASTER_HOST: "Master.Exemplo.com.br" };
    expect(evaluateMasterNetwork({ host: "master.exemplo.com.br", ip: "1.1.1.1" }, env).allowed).toBe(true);
    expect(evaluateMasterNetwork({ host: "master.exemplo.com.br:443", ip: "1.1.1.1" }, env).allowed).toBe(true);
    expect(evaluateMasterNetwork({ host: "loja.exemplo.com.br", ip: "1.1.1.1" }, env)).toEqual({ allowed: false, reason: "host" });
    expect(evaluateMasterNetwork({ host: "master.exemplo.com.br.evil.com", ip: "1.1.1.1" }, env).allowed).toBe(false);
    expect(evaluateMasterNetwork({ host: null, ip: "1.1.1.1" }, env).allowed).toBe(false);
  });
  it("MASTER_ALLOWED_IPS: só IPs da lista; lista inválida nega tudo (falha fechado)", () => {
    expect(evaluateMasterNetwork({ host: "x", ip: "203.0.113.7" }, { MASTER_ALLOWED_IPS: "203.0.113.7" }).allowed).toBe(true);
    expect(evaluateMasterNetwork({ host: "x", ip: "203.0.113.8" }, { MASTER_ALLOWED_IPS: "203.0.113.7" })).toEqual({ allowed: false, reason: "ip" });
    expect(evaluateMasterNetwork({ host: "x", ip: "unknown" }, { MASTER_ALLOWED_IPS: "203.0.113.7" }).allowed).toBe(false);
    expect(evaluateMasterNetwork({ host: "x", ip: "203.0.113.7" }, { MASTER_ALLOWED_IPS: "lixo, 999.1.1.1" }).allowed).toBe(false);
  });
  it("as duas regras valem juntas", () => {
    const env = { MASTER_HOST: "m.exemplo.com", MASTER_ALLOWED_IPS: "10.0.0.0/8" };
    expect(evaluateMasterNetwork({ host: "m.exemplo.com", ip: "10.1.2.3" }, env).allowed).toBe(true);
    expect(evaluateMasterNetwork({ host: "m.exemplo.com", ip: "11.1.2.3" }, env).allowed).toBe(false);
    expect(evaluateMasterNetwork({ host: "outro.com", ip: "10.1.2.3" }, env).allowed).toBe(false);
  });
});

describe("masterMfaRequired", () => {
  it("só com 'true' explícito", () => {
    expect(masterMfaRequired({ MASTER_REQUIRE_MFA: "true" })).toBe(true);
    expect(masterMfaRequired({ MASTER_REQUIRE_MFA: " TRUE " })).toBe(true);
    for (const v of [undefined, "", "false", "1", "yes"]) expect(masterMfaRequired({ MASTER_REQUIRE_MFA: v })).toBe(false);
  });
});
