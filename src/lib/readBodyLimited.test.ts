import { describe, expect, it, vi } from "vitest";
import { readBodyLimited } from "./readBodyLimited";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://x.test/api", { method: "POST", body, headers });

describe("readBodyLimited", () => {
  it("lê corpo pequeno inteiro", async () => {
    expect(await readBodyLimited(post('{"a":1}'), 100)).toBe('{"a":1}');
  });
  it("corpo vazio devolve texto vazio", async () => {
    expect(await readBodyLimited(post(null), 100)).toBe("");
  });
  it("Content-Length maior que o limite: nem abre o leitor do corpo", async () => {
    const req = post("pequeno", { "content-length": "999999" });
    const spy = vi.spyOn(req.body!, "getReader");
    expect(await readBodyLimited(req, 100)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it("corpo em pedaços sem tamanho declarado é cortado ao passar do limite", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 50) return c.close();
        sent += 1;
        c.enqueue(new Uint8Array(10));
      },
    });
    const req = new Request("https://x.test/api", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBodyLimited(req, 100)).toBeNull();
    expect(sent).toBeLessThan(50); // parou de ler antes do fim
  });
  it("exatamente no limite passa", async () => {
    expect(await readBodyLimited(post("x".repeat(100)), 100)).toHaveLength(100);
  });
});
