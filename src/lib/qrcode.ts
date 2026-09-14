/**
 * QR Code da loja (Sprint 4 — compartilhamento) — gerado sempre a partir da
 * URL pública real, nunca armazenado no banco (não há necessidade: é
 * determinístico a partir da própria URL, então persistiria um dado
 * derivado sem motivo). `QRCode.toDataURL` roda inteiramente no
 * navegador/processo local (biblioteca `qrcode`, sem chamada de rede),
 * então não é "backend novo".
 */

import QRCode from "qrcode";

export async function generateStoreQrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    margin: 1,
    width: 320,
    color: { dark: "#121826", light: "#ffffff" },
  });
}
