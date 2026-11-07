import { describe, expect, it } from "vitest";
import {
  evaluateMasterNetwork, ipInList, isMasterPath, masterMfaRequired, masterProxyHops, masterRequestHost, parseIp, parseIpList, pickMasterClientIp,
} from "./masterAccess";

describe("isMasterPath", () => {
  it("cobre o Master e a tela de segundo fator, nada além", () => {
    for (const p of ["/master", "/master/", "/master/usuarios", "/master-mfa"]) expect(isMasterPath(p), p).toBe(true);
    for (const p of ["/masters", "/masterplan", "/painel/master", "/loja/master", "/", "/master-mfa/x"]) expect(isMasterPath(p), p).toBe(false);
  });
});

describe("parseIp", () => {
  it("IPv4 válido; recusa octetos fora da faixa, zeros à esquerda (octal), pedaços faltando e lixo", () => {
    expect(parseIp("203.0.113.7")?.version).toBe(4);
    for (const bad of ["256.1.1.1", "1.2.3", "1.2.3.4.5", "010.0.0.1", "1.2.3.04", "a.b.c.d", "", " ", "1.2.3.4/24", "203.0.113.7;x", "1.2.3.4%eth0"]) expect(parseIp(bad), bad).toBeNull();
  });
  it("IPv6 em várias grafias equivale ao mesmo endereço", () => {
    const a = parseIp("2001:db8::1")!;
    expect(a.version).toBe(6);
    for (const same of ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:DB8:0:0:0:0:0:1", "2001:db8::0001", "2001:db8:0::1"]) expect(parseIp(same)?.value, same).toBe(a.value);
    expect(parseIp("::1")?.value).toBe(BigInt(1));
    expect(parseIp("::")?.value).toBe(BigInt(0));
  });
  it("recusa IPv6 malformado", () => {
    for (const bad of ["2001:db8:::1", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "12345::1", "g::1", "2001:db8::1%eth0", ":1", "1:", "::ffff:1.2.3", "1.2.3.4::1"]) expect(parseIp(bad), bad).toBeNull();
  });
  it("IPv4 mapeado em IPv6 é tratado como IPv4", () => {
    expect(parseIp("::ffff:203.0.113.7")).toEqual(parseIp("203.0.113.7"));
    expect(parseIp("::ffff:cb00:7107")?.version).toBe(4);
  });
});

describe("parseIpList / ipInList", () => {
  it("aceita IPv4, IPv6 e CIDR dos dois; descarta lixo", () => {
    expect(parseIpList(" 203.0.113.7 , 198.51.100.0/24, 2001:db8::/32, abc, 1.2.3.4/33, 300.1.1.1, 1.2.3.4/8/9, ::/129, , ")).toEqual(["203.0.113.7", "198.51.100.0/24", "2001:db8::/32"]);
    expect(parseIpList(undefined)).toEqual([]);
  });
  it("IPv4: exato, faixa, /0 e /32", () => {
    const list = parseIpList("203.0.113.7,198.51.100.0/24,10.0.0.0/8");
    expect(ipInList("203.0.113.7", list)).toBe(true);
    expect(ipInList("198.51.100.250", list)).toBe(true);
    expect(ipInList("198.51.101.1", list)).toBe(false);
    expect(ipInList("10.200.1.1", list)).toBe(true);
    expect(ipInList("203.0.113.8", list)).toBe(false);
    expect(ipInList("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
    expect(ipInList("8.8.8.9", ["8.8.8.8/32"])).toBe(false);
  });
  it("IPv6: grafias diferentes casam; faixa /32 e /64; outra rede não", () => {
    const list = parseIpList("2001:db8::1,2001:db8:abcd::/48");
    expect(ipInList("2001:0DB8:0:0:0:0:0:1", list)).toBe(true);
    expect(ipInList("2001:db8:abcd:ffff::5", list)).toBe(true);
    expect(ipInList("2001:db8:abce::1", list)).toBe(false);
    expect(ipInList("2001:db8::2", list)).toBe(false);
    expect(ipInList("::1", ["::/0"])).toBe(true);
  });
  it("versões não se misturam: lista IPv4 não casa IPv6 e vice-versa", () => {
    expect(ipInList("2001:db8::1", ["0.0.0.0/0"])).toBe(false);
    expect(ipInList("1.2.3.4", ["::/0"])).toBe(false);
  });
  it("IPv4 mapeado casa a lista IPv4 (e a faixa mapeada vale como IPv4)", () => {
    expect(ipInList("::ffff:203.0.113.7", ["203.0.113.7"])).toBe(true);
    expect(ipInList("203.0.113.7", ["::ffff:203.0.113.7"])).toBe(true);
    expect(ipInList("203.0.113.200", ["::ffff:203.0.113.0/120"])).toBe(true);
  });
  it("desconhecido, vazio e lixo nunca passam, nem com /0", () => {
    for (const bad of ["unknown", "", "  ", "abc", "1.2.3.4; x"]) expect(ipInList(bad, ["0.0.0.0/0", "::/0"]), bad).toBe(false);
  });
});

describe("pickMasterClientIp", () => {
  it("usa a entrada da DIREITA do X-Forwarded-For (a que o proxy de borda acrescentou), nunca a do cliente", () => {
    expect(pickMasterClientIp("203.0.113.7")).toBe("203.0.113.7");
    expect(pickMasterClientIp("203.0.113.7, 198.51.100.9")).toBe("198.51.100.9"); // cliente escreveu o 1º
    expect(pickMasterClientIp("1.1.1.1, 2.2.2.2, 198.51.100.9")).toBe("198.51.100.9");
  });
  it("com CDN à frente (hops=2) pega a penúltima; limita ao tamanho da cadeia", () => {
    expect(pickMasterClientIp("1.1.1.1, 203.0.113.7, 198.51.100.9", 2)).toBe("203.0.113.7");
    expect(pickMasterClientIp("203.0.113.7", 3)).toBe("203.0.113.7");
  });
  it("sem X-Forwarded-For ou com lixo: 'unknown' (X-Real-IP não é usado)", () => {
    expect(pickMasterClientIp(null)).toBe("unknown");
    expect(pickMasterClientIp("")).toBe("unknown");
    expect(pickMasterClientIp("203.0.113.7; DROP")).toBe("unknown");
    expect(pickMasterClientIp("evil, 999.1.1.1")).toBe("unknown");
  });
  it("normaliza IPv6 em minúsculas", () => {
    expect(pickMasterClientIp("2001:DB8::1")).toBe("2001:db8::1");
  });
});

describe("masterRequestHost / masterProxyHops", () => {
  it("o host vem SÓ do cabeçalho Host (X-Forwarded-Host é ignorado)", () => {
    const h = new Headers({ host: "loja.exemplo.com", "x-forwarded-host": "master.exemplo.com" });
    expect(masterRequestHost(h)).toBe("loja.exemplo.com");
  });
  it("hops: inteiro de 1 a 5, senão 1", () => {
    expect(masterProxyHops({ MASTER_PROXY_HOPS: "2" })).toBe(2);
    for (const v of [undefined, "", "0", "6", "x", "1.5", "-1"]) expect(masterProxyHops({ MASTER_PROXY_HOPS: v }), String(v)).toBe(1);
  });
});

describe("evaluateMasterNetwork", () => {
  it("sem configuração: libera (comportamento atual)", () => {
    expect(evaluateMasterNetwork({ host: "qualquer.com", ip: "1.1.1.1" }, {})).toEqual({ allowed: true });
    expect(evaluateMasterNetwork({ host: "x", ip: "unknown" }, { MASTER_HOST: "  ", MASTER_ALLOWED_IPS: "" })).toEqual({ allowed: true });
  });
  it("MASTER_HOST: só o domínio configurado (sem diferenciar caixa, porta nem ponto final)", () => {
    const env = { MASTER_HOST: "Master.Exemplo.com.br" };
    for (const ok of ["master.exemplo.com.br", "master.exemplo.com.br:443", "MASTER.exemplo.com.br.", "master.exemplo.com.br:3000"]) expect(evaluateMasterNetwork({ host: ok, ip: "1.1.1.1" }, env).allowed, ok).toBe(true);
    for (const bad of ["loja.exemplo.com.br", "master.exemplo.com.br.evil.com", "xmaster.exemplo.com.br", "master.exemplo.com.br@evil.com", "", null]) {
      expect(evaluateMasterNetwork({ host: bad, ip: "1.1.1.1" }, env), String(bad)).toEqual({ allowed: false, reason: "host" });
    }
  });
  it("MASTER_ALLOWED_IPS: IPv4, IPv6 e faixas; lista inválida nega tudo (falha fechado)", () => {
    const env = { MASTER_ALLOWED_IPS: "203.0.113.7, 2001:db8::/32" };
    expect(evaluateMasterNetwork({ host: "x", ip: "203.0.113.7" }, env).allowed).toBe(true);
    expect(evaluateMasterNetwork({ host: "x", ip: "2001:db8:1::9" }, env).allowed).toBe(true);
    expect(evaluateMasterNetwork({ host: "x", ip: "203.0.113.8" }, env)).toEqual({ allowed: false, reason: "ip" });
    expect(evaluateMasterNetwork({ host: "x", ip: "unknown" }, env).allowed).toBe(false);
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
