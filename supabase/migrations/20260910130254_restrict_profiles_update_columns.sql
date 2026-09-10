-- Correção: a migration anterior tentou REVOKE UPDATE (document, trial_*)
-- FROM authenticated, mas isso NÃO tem efeito nenhum, porque profiles já
-- tinha GRANT ALL (tabela inteira) para authenticated desde o Sprint 1
-- (relacl: authenticated=arwdDxtm/postgres). Em Postgres, um GRANT no nível
-- da tabela inteira e um GRANT/REVOKE por coluna são UNION, não OVERRIDE:
-- não dá pra restringir colunas específicas revogando só nelas quando a
-- tabela inteira já foi liberada. Confirmado por teste real (SQL contra o
-- projeto MenuNext): o REVOKE por coluna sozinho não bloqueou o UPDATE.
--
-- Correção: revogar UPDATE da tabela inteira de authenticated/anon e
-- conceder de volta só nas colunas que o app realmente precisa que o
-- próprio usuário edite (name, phone). document/trial_* ficam de fora —
-- só o trigger handle_new_user (SECURITY DEFINER, dono da tabela) escreve
-- neles.
--
-- Backfill: esta migration já estava aplicada no projeto quando este
-- arquivo foi adicionado ao repositório.
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

grant update (name, phone) on public.profiles to authenticated;
