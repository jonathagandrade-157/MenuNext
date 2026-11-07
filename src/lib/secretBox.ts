/**
 * Cifra de segredos guardados no banco (hoje: o Access Token do Mercado Pago de cada loja, para o Pix automático).
 * SÓ SERVIDOR. AES-256-GCM com chave de 32 bytes em `PAYMENTS_ENCRYPTION_KEY` (base64), que nunca entra no banco:
 * quem tiver só o banco (backup, vazamento) não consegue usar os tokens.
 *
 * Formato gravado: `v1:<iv>:<tag>:<texto cifrado>` (base64url). O contexto (ex.: id da loja) entra como dado
 * autenticado: o texto cifrado de uma loja não decifra como se fosse de outra.
 * Trocar a chave invalida os tokens gravados (os lojistas colam de novo) — ver docs/operacao/pix-automatico.md.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export function parseEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return key.length === 32 ? key : null;
}

export function getEncryptionKey(): Buffer | null {
  return parseEncryptionKey(process.env.PAYMENTS_ENCRYPTION_KEY);
}

export function sealSecret(plaintext: string, context: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(":");
}

/** Devolve o segredo ou null (formato inválido, chave errada, contexto errado ou texto adulterado). */
export function openSecret(sealed: string | null | undefined, context: string, key: Buffer): string | null {
  if (!sealed) return null;
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const body = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
