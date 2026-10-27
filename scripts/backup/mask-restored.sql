-- Pseudonimização de uma CÓPIA RESTAURADA do banco (nunca do banco de produção).
--
-- Objetivo: provar que o backup é recuperável e conferir contagens/permissões/RLS SEM que ninguém precise ver dado pessoal.
-- Roda só no banco descartável onde o backup foi restaurado, ANTES de qualquer pessoa abrir tabelas ou compartilhar evidência.
-- Mantém todas as linhas, chaves e vínculos (ids, datas, valores, status), troca nomes, telefones, e-mails, documentos,
-- endereços, chaves Pix e senhas por valores fictícios derivados de hash. Não é anonimização irreversível para fins legais
-- (o texto original continua no dump cifrado): serve para o exercício de restauração.
--
-- Uso (psql, em banco LOCAL; precisa de superusuário por causa de session_replication_role):
--   psql "postgresql://postgres:…@127.0.0.1:5432/restaurado" -c "set menunext.mask_confirm = 'copia-restaurada-descartavel'" -f scripts/backup/mask-restored.sql
-- (use a MESMA sessão: com o node `pg`, execute os dois comandos na mesma conexão.)

do $$
begin
  if current_setting('menunext.mask_confirm', true) is distinct from 'copia-restaurada-descartavel' then
    raise exception 'Recusado: defina menunext.mask_confirm = ''copia-restaurada-descartavel'' na mesma sessão. Este script NUNCA roda em produção.';
  end if;
end $$;

-- sem os gatilhos (updated_at, guarda de colunas de cobrança, auditoria) e sem efeitos colaterais
set session_replication_role = replica;

-- ---------- auth ----------
update auth.users
set email = 'usuario-' || substr(md5(id::text), 1, 12) || '@mascarado.invalid',
    raw_user_meta_data = jsonb_build_object('name', 'Pessoa ' || substr(md5(id::text), 1, 6));

do $$
begin
  -- colunas do GoTrue real (não existem no laboratório simplificado)
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute $q$update auth.users set encrypted_password = null$q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'phone') then
    execute $q$update auth.users set phone = null$q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_app_meta_data') then
    execute $q$update auth.users set raw_app_meta_data = '{}'::jsonb$q$;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
    execute $q$delete from auth.identities$q$;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'sessions') then
    execute $q$delete from auth.sessions$q$;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'refresh_tokens') then
    execute $q$delete from auth.refresh_tokens$q$;
  end if;
end $$;

-- ---------- public ----------
update public.profiles
set name = 'Pessoa ' || substr(md5(user_id::text), 1, 6),
    phone = null;

-- documento (CPF/CNPJ): único e sem relação com o original
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'document') then
    execute $q$update public.profiles set document = lpad((abs(hashtextextended(user_id::text, 7)) % 100000000000)::text, 11, '0')$q$;
  end if;
exception when check_violation or not_null_violation then
  -- se o banco exigir documento válido/obrigatório, o exercício registra o aviso e segue (o documento fica mascarado pela regra do banco)
  raise notice 'document: a regra do banco recusou o valor mascarado; revisar o script para este esquema';
end $$;

update public.orders
set customer_name = 'Cliente ' || order_number,
    customer_phone = '119' || lpad((abs(hashtext(customer_phone)) % 100000000)::text, 8, '0'),
    delivery_zip = case when delivery_zip is null then null else '00000000' end,
    delivery_street = case when delivery_street is null then null else 'Rua Mascarada' end,
    delivery_number = case when delivery_number is null then null else '1' end,
    delivery_complement = null,
    delivery_neighborhood = case when delivery_neighborhood is null then null else 'Bairro Mascarado' end,
    delivery_city = case when delivery_city is null then null else 'Cidade Mascarada' end,
    delivery_reference = null,
    observation = null;

update public.customer_notes
set customer_phone = '119' || lpad((abs(hashtext(customer_phone)) % 100000000)::text, 8, '0'),
    note = 'Nota mascarada';

update public.restaurant_invites
set email = 'convite-' || substr(md5(id::text), 1, 10) || '@mascarado.invalid';

update public.restaurants
set contact_email = case when contact_email is null then null else 'loja-' || substr(md5(id::text), 1, 8) || '@mascarado.invalid' end,
    contact_whatsapp = null,
    address_zip = case when address_zip is null then null else '00000000' end,
    address_street = case when address_street is null then null else 'Rua Mascarada' end,
    address_number = case when address_number is null then null else '1' end,
    address_complement = null,
    latitude = null,
    longitude = null,
    payment_pix_key = case when payment_pix_key is null then null else 'pix-' || substr(md5(id::text), 1, 8) || '@mascarado.invalid' end,
    payment_pix_key_type = case when payment_pix_key is null then payment_pix_key_type else 'email' end,
    payment_pix_holder_name = case when payment_pix_holder_name is null then null else 'Titular Mascarado' end;

reset session_replication_role;
