-- Papel de backup com PRIVILÉGIO MÍNIMO (somente leitura). NÃO foi executado em produção: exige autorização expressa do dono.
-- Já foi testado num PostgreSQL 17 descartável local; o comportamento no Supabase real NÃO foi verificado (ver S5 no pacote privado).
--
-- Como usar (um humano, uma vez, como o papel `postgres`, no SQL Editor do Supabase ou no psql):
--   1) Rode este arquivo SEM senha: o papel nasce sem senha e portanto sem como entrar.
--   2) Defina a senha por um canal que não grave texto claro em arquivo versionado (psql: \password backup_ro). No SQL Editor
--      a senha fica no histórico do editor: gere uma senha longa, use-a só no backup e troque-a depois.
--   3) Monte DATABASE_URL só na sessão do terminal (usuário `backup_ro`; no pooler de sessão é `backup_ro.<ref-do-projeto>`).
-- Nenhuma senha, chave ou URL real pode ser colocada neste arquivo.

create role backup_ro
  login
  nosuperuser nocreatedb nocreaterole noreplication
  bypassrls          -- o pg_dump precisa ler as tabelas com RLS; sem isto o dump falha em vez de sair incompleto
  connection limit 2;

-- Leitura de TODOS os dados e nada mais: pg_read_all_data dá SELECT em tabelas/visões/sequências e USAGE nos esquemas.
-- Não há INSERT/UPDATE/DELETE, não há CREATE em nenhum esquema, não há papel de escrita herdado.
grant pg_read_all_data to backup_ro;

-- Camada extra no SERVIDOR (além do PGOPTIONS do cliente): toda sessão deste papel já nasce somente leitura.
alter role backup_ro set default_transaction_read_only = on;
alter role backup_ro set statement_timeout = '30min';
alter role backup_ro set idle_in_transaction_session_timeout = '5min';

-- Conferência (deve devolver backup_ro|f|f|f|f|t|on|0|0 numa nova sessão do papel; o backup-db.mjs repete esta sonda):
--   select rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls from pg_roles where rolname = 'backup_ro';
