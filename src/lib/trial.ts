/**
 * Progresso do período de teste (profiles.trial_started_at / trial_ends_at,
 * legível pelo próprio dono). Puro, com `now` injetável para os testes.
 * Devolve null quando não há teste em andamento (sem datas ou já terminou) —
 * quem terminou sem plano é tratado pelo bloqueio de acesso, não aqui.
 */
export type TrialProgress = {
  daysLeft: number;
  totalDays: number;
  usedDays: number;
  percentUsed: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeTrialProgress(
  startedAt: string | null,
  endsAt: string | null,
  now: Date = new Date()
): TrialProgress | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end) || end <= now.getTime()) return null;

  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const totalMs = Number.isNaN(start) || start >= end ? 30 * DAY_MS : end - start;
  const leftMs = end - now.getTime();

  const totalDays = Math.max(1, Math.round(totalMs / DAY_MS));
  const daysLeft = Math.min(totalDays, Math.max(1, Math.ceil(leftMs / DAY_MS)));
  const percentUsed = Math.min(100, Math.max(0, Math.round(((totalMs - leftMs) / totalMs) * 100)));
  return { daysLeft, totalDays, usedDays: totalDays - daysLeft, percentUsed };
}
