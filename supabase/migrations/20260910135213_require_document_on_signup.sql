-- Torna CPF/CNPJ obrigatório para todo cadastro novo, garantido no
-- trigger (backend), não só pelo required do formulário. Uma chamada
-- direta a auth.signUp() sem `document` no metadata (ou com um documento
-- inválido) agora aborta a criação inteira da conta — mesmo mecanismo
-- atômico já usado para bloquear documento duplicado.
--
-- Não é feito via `ALTER TABLE profiles ALTER COLUMN document SET NOT
-- NULL` porque isso quebraria a linha de profile pré-existente (criada
-- antes desta feature, sem documento) e essa conta já existente não deve
-- ser afetada — só cadastros novos passam pelo trigger novamente.
--
-- Backfill: esta migration já estava aplicada no projeto quando este
-- arquivo foi adicionado ao repositório.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_document text := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'document', ''), '\D', '', 'g'), '');
begin
  if v_document is null or not public.is_valid_document(v_document) then
    raise exception 'document_required' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, name, phone, document, trial_started_at, trial_ends_at, trial_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'phone',
    v_document,
    now(),
    now() + interval '30 days',
    'active'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
