/**
 * Pix BR Code (EMV-MPM, "copia e cola" / QR estático) — gerado 100%
 * localmente a partir da chave Pix já cadastrada pelo lojista (nenhuma API
 * externa, nenhum PSP): implementação do padrão público do Banco Central
 * (Manual de Padrões para Iniciação do Pix). QR sem valor fixo — o cliente
 * digita o valor no app do banco; um QR com valor fixo vinculado a um
 * pedido específico (txid = número do pedido) fica fora desta entrega, ver
 * commit da área Pagamentos.
 */

export type PixKeyType = "cpf_cnpj" | "email" | "telefone" | "aleatoria";

export const PIX_KEY_TYPE_LABEL: Record<PixKeyType, string> = {
  cpf_cnpj: "CNPJ / CPF",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave Aleatória",
};

function emvField(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, sem reflexão) — algoritmo
 * exigido pelo campo 63 do BR Code. Vetor de teste padrão do algoritmo
 * (independente de Pix): crc16("123456789") === "29B1". */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** O EMV só aceita Latin básico (sem acentos) em nome/cidade do
 * recebedor — mesma normalização que qualquer maquininha/banco aplica. */
function sanitizeAscii(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  return (normalized || "NA").slice(0, maxLength);
}

export function generatePixBrCode({
  pixKey,
  merchantName,
  merchantCity,
}: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
}): string {
  const merchantAccountInfo = emvField("00", "br.gov.bcb.pix") + emvField("01", pixKey.trim());
  const additionalData = emvField("05", "***");

  const payload =
    emvField("00", "01") +
    emvField("26", merchantAccountInfo) +
    emvField("52", "0000") +
    emvField("53", "986") +
    emvField("58", "BR") +
    emvField("59", sanitizeAscii(merchantName, 25)) +
    emvField("60", sanitizeAscii(merchantCity, 15)) +
    emvField("62", additionalData) +
    "6304";

  return payload + crc16(payload);
}
