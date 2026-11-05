-- Passos OBRIGATÓRIOS depois de restaurar o dump, para objetos que o pg_dump com filtro de esquemas (--schema) NÃO leva.
-- Idempotente: pode rodar mais de uma vez. Seguro em PostgreSQL comum e em projeto Supabase.
--
-- 1) Publicação do Realtime: o Kanban e o KDS ouvem mudanças da tabela public.orders pela publicação supabase_realtime
--    (migration 20260911130000). Sem isso, depois de uma restauração o painel continua abrindo mas PARA de atualizar sozinho.
--    O exercício com pg_dump 17.6 real mostrou que o dump filtrado não carrega a publicação.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- 2) Conferência rápida (deve devolver 1 linha): public.orders publicada no Realtime
select pubname, schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders';
