-- Sonda SOMENTE LEITURA do papel usado na conexão de origem do backup. Uma única linha, separada por "|":
--   papel | superusuario | cria_papeis | cria_bancos | replicacao | ignora_rls | sessao_somente_leitura | tabelas_gravaveis | esquemas_com_create
-- Uso (feito por backup-db.mjs): psql -X -At -F "|" -v schemas=public,auth,storage -f source-role-probe.sql
-- O papel de backup ideal (create-backup-role.sql) devolve: backup_ro|f|f|f|f|t|on|0|0
select
  r.rolname,
  r.rolsuper,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolreplication,
  r.rolbypassrls,
  current_setting('default_transaction_read_only'),
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any (string_to_array(:'schemas', ','))
      and c.relkind in ('r', 'p')
      and has_table_privilege(r.rolname, c.oid, 'INSERT,UPDATE,DELETE')),
  (select count(*)
     from pg_namespace n
    where n.nspname = any (string_to_array(:'schemas', ','))
      and has_schema_privilege(r.rolname, n.oid, 'CREATE'))
from pg_roles r
where r.rolname = current_user;
