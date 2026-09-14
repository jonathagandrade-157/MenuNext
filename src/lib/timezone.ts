/**
 * Fronteira de "hoje" no timezone do restaurante (Sprint 4 — Dashboard).
 * O projeto não guarda timezone por restaurante (mesma limitação já
 * documentada em computeStoreOpenState, src/lib/store.ts); como todo
 * restaurante hoje é operado a partir do Brasil, usamos America/Sao_Paulo
 * fixo em vez da hora local do processo Node (que em produção roda em UTC —
 * "hoje" mudaria às 21h de SP, não à meia-noite real). `now` é injetável
 * para os testes controlarem o relógio, mesmo padrão de computeStoreOpenState.
 */

export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function getPartsInTimeZone(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl formata meia-noite como "24" em hour12: false — normaliza para 0.
    hour: map.hour === "24" ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Deslocamento (minutos) de `timeZone` em relação a UTC no instante `date`. */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getPartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Início do dia civil (00:00:00) em `timeZone`, para o dia em que `now` cai
 * NESSE timezone — devolvido como o instante UTC equivalente (usável direto
 * em filtros `.gte("created_at", ...)`). Uma iteração de ajuste é suficiente
 * porque o Brasil não observa horário de verão desde 2019 (offset constante).
 */
export function getStartOfDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = getPartsInTimeZone(now, timeZone);
  const midnightGuess = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  const offsetMinutes = getTimeZoneOffsetMinutes(new Date(midnightGuess), timeZone);
  return new Date(midnightGuess - offsetMinutes * 60000);
}
