/**
 * Reaceite dos textos legais. O cadastro grava, nos metadados do usuário, a
 * versão dos Termos/Política que a pessoa aceitou (terms_version, ver
 * signUpAction). Quando os textos mudam (LEGAL_LAST_UPDATED), quem aceitou uma
 * versão anterior — ou nunca registrou aceite, como as contas criadas antes
 * deste recurso — precisa aceitar de novo antes de seguir usando o painel.
 */
export function needsTermsAcceptance(
  userMetadata: Record<string, unknown> | null | undefined,
  currentVersion: string
): boolean {
  return userMetadata?.terms_version !== currentVersion;
}
