/** True quando o erro do PostgREST/Postgres significa "esta função/tabela não existe neste banco" (migration não aplicada). */
export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42883" || error.code === "42P01" ||
    /could not find the (function|table)|does not exist/i.test(error.message ?? "")
  );
}
