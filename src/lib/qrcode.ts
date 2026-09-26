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

/** Mesmo gerador acima, só que para o payload Pix BR Code (área Pagamentos)
 * em vez da URL da loja — o conteúdo do QR é só uma string, o gerador não
 * sabe nem precisa saber que é Pix. */
export async function generatePixQrCodeDataUrl(brCode: string): Promise<string> {
  return QRCode.toDataURL(brCode, {
    margin: 1,
    width: 280,
    color: { dark: "#121826", light: "#ffffff" },
  });
}
