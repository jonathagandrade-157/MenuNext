/**
 * CPF/CNPJ do responsável pela conta (lojista/contratante do MenuNext) — não
 * confundir com dados do cliente final do restaurante, que não usa isto.
 *
 * A mesma validação de dígito verificador implementada aqui é espelhada em
 * SQL (função `public.is_valid_document`, na migration) para que a regra
 * também seja garantida no banco, não só no cliente.
 */

export type DocumentType = "CPF" | "CNPJ";

/** Remove tudo que não for dígito. */
export function normalizeDocument(input: string): string {
  return input.replace(/\D/g, "");
}

/** Aplica a máscara de CPF ou CNPJ conforme a quantidade de dígitos já digitados. */
export function maskDocument(input: string): string {
  const digits = normalizeDocument(input).slice(0, 14);

  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }

  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function isAllSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function calcCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCPF(rawOrDigits: string): boolean {
  const digits = normalizeDocument(rawOrDigits);
  if (digits.length !== 11 || isAllSameDigit(digits)) return false;

  const firstCheck = calcCheckDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstCheck !== Number(digits[9])) return false;

  const secondCheck = calcCheckDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (secondCheck !== Number(digits[10])) return false;

  return true;
}

export function isValidCNPJ(rawOrDigits: string): boolean {
  const digits = normalizeDocument(rawOrDigits);
  if (digits.length !== 14 || isAllSameDigit(digits)) return false;

  const firstCheck = calcCheckDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstCheck !== Number(digits[12])) return false;

  const secondCheck = calcCheckDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (secondCheck !== Number(digits[13])) return false;

  return true;
}

export function documentTypeOf(digits: string): DocumentType | null {
  if (digits.length === 11) return "CPF";
  if (digits.length === 14) return "CNPJ";
  return null;
}

/** Valida CPF (11 dígitos) ou CNPJ (14 dígitos) real — aceita com ou sem máscara. */
export function isValidDocument(rawOrDigits: string): boolean {
  const digits = normalizeDocument(rawOrDigits);
  if (digits.length === 11) return isValidCPF(digits);
  if (digits.length === 14) return isValidCNPJ(digits);
  return false;
}
