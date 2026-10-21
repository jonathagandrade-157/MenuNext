import { describe, expect, it } from "vitest";
import {
  buildMercadoPagoManifest,
  computeMercadoPagoSignature,
  parseMercadoPagoWebhook,
  verifyMercadoPagoSignature,
} from "./mercadopagoWebhook";

const SECRET = "segredo-de-teste-mp";

function signed(opts: { dataId: string | null; requestId: string | null; ts?: string; secret?: string }) {
  const ts = opts.ts ?? "1700000000000";
  const v1 = computeMercadoPagoSignature(
    opts.secret ?? SECRET,
    buildMercadoPagoManifest({ dataId: opts.dataId, requestId: opts.requestId, ts })
  );
  return `ts=${ts},v1=${v1}`;
}

describe("manifesto", () => {
  it("segue o formato id;request-id;ts e põe o id em minúsculas", () => {
    expect(buildMercadoPagoManifest({ dataId: "ABC123", requestId: "req-1", ts: "99" })).toBe("id:abc123;request-id:req-1;ts:99;");
  });
  it("omite os pares ausentes", () => {
    expect(buildMercadoPagoManifest({ dataId: null, requestId: null, ts: "99" })).toBe("ts:99;");
    expect(buildMercadoPagoManifest({ dataId: "1", requestId: null, ts: "99" })).toBe("id:1;ts:99;");
  });
});

describe("verifyMercadoPagoSignature", () => {
  it("aceita assinatura válida", () => {
    const xSignature = signed({ dataId: "123", requestId: "r1" });
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "123", secret: SECRET })).toBe(true);
  });

  it("aceita id alfanumérico em maiúsculas (manifesto usa minúsculas)", () => {
    const xSignature = signed({ dataId: "ord01abc", requestId: "r1" });
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "ORD01ABC", secret: SECRET })).toBe(true);
  });

  it("recusa segredo errado, id adulterado e request-id adulterado", () => {
    const xSignature = signed({ dataId: "123", requestId: "r1" });
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "123", secret: "outro" })).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "124", secret: SECRET })).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r2", dataId: "123", secret: SECRET })).toBe(false);
  });

  it("recusa ts adulterado", () => {
    const xSignature = signed({ dataId: "123", requestId: "r1", ts: "1700000000000" }).replace(
      "ts=1700000000000",
      "ts=1700000000001"
    );
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "123", secret: SECRET })).toBe(false);
  });

  it("falha fechado sem segredo, sem cabeçalho ou com cabeçalho malformado", () => {
    const xSignature = signed({ dataId: "123", requestId: "r1" });
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "123", secret: undefined })).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature, xRequestId: "r1", dataId: "123", secret: "" })).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature: null, xRequestId: "r1", dataId: "123", secret: SECRET })).toBe(false);
    const malformed = ["", "ts=1", "v1=abc", `ts=abc,v1=${"0".repeat(64)}`, "ts=1,v1=zz", `ts=1,v1=${"0".repeat(63)}`];
    for (const bad of malformed) {
      expect(verifyMercadoPagoSignature({ xSignature: bad, xRequestId: "r1", dataId: "123", secret: SECRET })).toBe(false);
    }
  });

  it("aceita v1 em maiúsculas e espaço depois da vírgula", () => {
    const [ts, v1] = signed({ dataId: "123", requestId: "r1" }).split(",");
    const header = `${ts}, v1=${v1.slice(3).toUpperCase()}`;
    expect(verifyMercadoPagoSignature({ xSignature: header, xRequestId: "r1", dataId: "123", secret: SECRET })).toBe(true);
  });
});

describe("parseMercadoPagoWebhook", () => {
  it("lê evento de assinatura (preapproval)", () => {
    const event = parseMercadoPagoWebhook(
      { id: 9988, type: "subscription_preapproval", action: "updated", data: { id: "2c93abc" } },
      { dataId: "2c93abc", topic: null }
    );
    expect(event).toEqual({ kind: "preapproval", eventId: "mp:9988", resourceId: "2c93abc", action: "updated" });
  });

  it("lê evento de cobrança da assinatura (authorized_payment) pelo tópico da query", () => {
    const event = parseMercadoPagoWebhook(
      { id: "evt-1", data: { id: "555" } },
      { dataId: "555", topic: "subscription_authorized_payment" }
    );
    expect(event?.kind).toBe("authorized_payment");
    expect(event?.resourceId).toBe("555");
  });

  it("usa o id da QUERY (assinado) e descarta evento cujo corpo contradiz a query", () => {
    expect(
      parseMercadoPagoWebhook(
        { id: 1, type: "subscription_preapproval", data: { id: "OUTRO" } },
        { dataId: "2c93abc", topic: null }
      )
    ).toBeNull();
  });

  it("ignora pagamentos avulsos, tópicos desconhecidos e payloads vazios", () => {
    expect(parseMercadoPagoWebhook({ id: 1, type: "payment", data: { id: "1" } }, { dataId: "1", topic: null })).toBeNull();
    expect(parseMercadoPagoWebhook({ id: 1, type: "merchant_order" }, { dataId: "1", topic: null })).toBeNull();
    expect(parseMercadoPagoWebhook({ id: 1, type: "subscription_preapproval" }, { dataId: null, topic: null })).toBeNull();
    expect(parseMercadoPagoWebhook(null, { dataId: "1", topic: "subscription_preapproval" })).toBeNull();
  });

  it("gera id de evento composto quando o corpo não traz id", () => {
    const event = parseMercadoPagoWebhook({ type: "subscription_preapproval", action: "created" }, { dataId: "abc", topic: null });
    expect(event?.eventId).toBe("mp:preapproval:abc:created");
  });
});
