/**
 * Lê no máximo `max` bytes do corpo. Corpo declarado maior (Content-Length) nem começa a ser lido, e um corpo sem
 * tamanho declarado (chunked) é cortado ao passar do limite — um robô não consegue fazer o servidor carregar
 * megabytes em memória por um endpoint público e sem login. Devolve null se passou do limite.
 */
export async function readBodyLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
