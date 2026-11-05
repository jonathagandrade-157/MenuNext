-- Impressão digital ESTRUTURAL do banco (somente leitura; não mostra dado pessoal): funções, políticas, RLS, GRANTs,
-- gatilhos, índices, restrições, privilégios padrão e tabelas publicadas no Realtime (o Kanban/KDS depende de public.orders
-- estar na publicação supabase_realtime). Rode no banco de origem (produção, só leitura) e no banco restaurado:
-- as duas colunas `impressao` precisam ser IGUAIS. Para as tabelas, compare as contagens (veja `contagens` no fim).
--
-- O texto de um CHECK pode voltar com parênteses diferentes depois de dump/restore; por isso as restrições são comparadas
-- sem parênteses e sem espaços.

select 'funcoes' as item, md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text)) as impressao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth') and p.prokind = 'f'
union all
select 'politicas', md5(string_agg(format('%s.%s.%s.%s.%s.%s', schemaname, tablename, policyname, cmd, roles, coalesce(qual, '') || coalesce(with_check, '')), '|' order by schemaname, tablename, policyname))
from pg_policies where schemaname in ('public', 'storage')
union all
select 'rls', md5(string_agg(format('%s.%s=%s/%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity), '|' order by n.nspname, c.relname))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'auth', 'storage')
union all
select 'grants_tabelas', md5(string_agg(format('%s|%s|%s|%s', table_schema, table_name, grantee, privilege_type), '|' order by table_schema, table_name, grantee, privilege_type))
from information_schema.role_table_grants
where table_schema in ('public', 'auth', 'storage') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
union all
select 'grants_funcoes', md5(string_agg(format('%s|%s|%s|%s', routine_schema, routine_name, grantee, privilege_type), '|' order by routine_schema, routine_name, grantee, privilege_type))
from information_schema.role_routine_grants
where routine_schema in ('public', 'auth') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
union all
select 'gatilhos', md5(string_agg(format('%s.%s.%s', c.relname, t.tgname, pg_get_triggerdef(t.oid)), '|' order by c.relname, t.tgname))
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')
union all
select 'indices', md5(string_agg(indexdef, '|' order by schemaname, tablename, indexname))
from pg_indexes where schemaname in ('public', 'auth', 'storage')
union all
select 'restricoes', md5(string_agg(format('%s.%s.%s.%s', c.conrelid::regclass, c.conname, c.contype, regexp_replace(pg_get_constraintdef(c.oid), '[() ]', '', 'g')), '|' order by c.conrelid::regclass::text, c.conname))
from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where n.nspname in ('public', 'auth', 'storage')
union all
select 'privilegios_padrao', coalesce(md5(string_agg(v, '|' order by v)), '')
from (select format('%s|%s|%s|%s', defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl) as v from pg_default_acl) z
union all
select 'publicacoes_realtime', coalesce(md5(string_agg(v, '|' order by v)), '')
from (select format('%s|%s.%s', pubname, schemaname, tablename) as v from pg_publication_tables where schemaname in ('public', 'auth', 'storage')) z
order by 1;

-- contagem de linhas por tabela (compare com cuidado: a produção continua recebendo pedidos depois do dump)
-- select n.nspname, c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text as linhas
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where c.relkind = 'r' and n.nspname in ('public', 'auth', 'storage') order by 1, 2;
