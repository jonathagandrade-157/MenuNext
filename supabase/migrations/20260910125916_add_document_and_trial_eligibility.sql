-- MenuNext — CPF/CNPJ do contratante + elegibilidade do trial de 30 dias.
-- Backfill: esta migration já estava aplicada no projeto (via apply_migration)
-- quando este arquivo foi adicionado ao repositório — reproduz exatamente o
-- SQL executado, para manter supabase/migrations como fonte fiel do estado
-- real do banco.

-- 1) Funções puras de validação de CPF/CNPJ (espelham src/lib/document.ts
--    ponto a ponto: mesmos pesos, mesma fórmula de dígito verificador).
--    IMMUTABLE: dependem só do argumento, sem leitura de tabela.
create or replace function public._document_check_digit(p_digits text, p_weights int[])
returns int
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_sum int := 0;
  v_remainder int;
  i int;
begin
  for i in 1..array_length(p_weights, 1) loop
    v_sum := v_sum + p_weights[i] * substr(p_digits, i, 1)::int;
  end loop;
  v_remainder := v_sum % 11;
  return case when v_remainder < 2 then 0 else 11 - v_remainder end;
end;
$$;

create or replace function public.is_valid_document(p_document text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_document, ''), '\D', '', 'g');
  v_len int := length(v_digits);
begin
  if v_len <> 11 and v_len <> 14 then
    return false;
  end if;

  -- rejeita sequências de dígitos repetidos (111.111.111-11 etc.)
  if v_digits = repeat(substr(v_digits, 1, 1), v_len) then
    return false;
  end if;

  if v_len = 11 then
    if public._document_check_digit(v_digits, array[10,9,8,7,6,5,4,3,2]) <> substr(v_digits, 10, 1)::int then
      return false;
    end if;
    if public._document_check_digit(v_digits, array[11,10,9,8,7,6,5,4,3,2]) <> substr(v_digits, 11, 1)::int then
      return false;
    end if;
    return true;
  else
    if public._document_check_digit(v_digits, array[5,4,3,2,9,8,7,6,5,4,3,2]) <> substr(v_digits, 13, 1)::int then
      return false;
    end if;
    if public._document_check_digit(v_digits, array[6,5,4,3,2,9,8,7,6,5,4,3,2]) <> substr(v_digits, 14, 1)::int then
      return false;
    end if;
    return true;
  end if;
end;
$$;

comment on function public.is_valid_document(text) is
  'Valida dígito verificador de CPF (11 dígitos) ou CNPJ (14 dígitos). Espelha src/lib/document.ts — mantenha os dois em sincronia.';

-- 2) Colunas novas em profiles (documento do responsável pela conta + trial).
--    Nunca no restaurants/products/etc — isto é identidade do contratante,
--    não dado do restaurante nem do cliente final.
alter table public.profiles
  add column document text,
  add column trial_started_at timestamptz,
  add column trial_ends_at timestamptz,
  add column trial_status text;

alter table public.profiles
  add constraint profiles_document_valid check (document is null or public.is_valid_document(document)),
  add constraint profiles_trial_status_valid check (trial_status is null or trial_status in ('active','expired')),
  add constraint profiles_document_unique unique (document);

-- 3) Elegibilidade: 1 documento = 1 trial, para sempre. SECURITY DEFINER
--    porque precisa enxergar todas as contas (para checar unicidade), mas
--    retorna só um boolean — nunca o documento nem o dono.
--    Grant para anon TAMBÉM (não só authenticated): a checagem acontece no
--    formulário de cadastro, antes de existir sessão.
create or replace function public.is_document_eligible(p_document text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    public.is_valid_document(p_document)
    and not exists (
      select 1 from public.profiles
      where document = regexp_replace(coalesce(p_document, ''), '\D', '', 'g')
    );
$$;

comment on function public.is_document_eligible(text) is
  'Uso público (anon+authenticated) no formulário de cadastro para pré-checar elegibilidade ao trial antes do signUp. A garantia real e à prova de corrida é o UNIQUE constraint em profiles.document, verificado de novo no INSERT feito por handle_new_user.';

revoke all on function public.is_document_eligible(text) from public;
grant execute on function public.is_document_eligible(text) to anon, authenticated;

-- 4) handle_new_user: grava documento + trial (30 dias) a partir do
--    raw_user_meta_data passado no signUp(). Continua SECURITY DEFINER,
--    então o INSERT ignora tanto RLS quanto os REVOKEs de coluna abaixo.
--    Se o documento vier ausente/incompleto, o profile é criado do mesmo
--    jeito (sem trial) — não derruba o cadastro.
--    (Esta versão foi substituída pela migration require_document_on_signup,
--    que passa a exigir documento válido — mantida aqui fiel ao que foi
--    aplicado nesta migration específica.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_document text := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'document', ''), '\D', '', 'g'), '');
begin
  insert into public.profiles (user_id, name, phone, document, trial_started_at, trial_ends_at, trial_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'phone',
    v_document,
    case when v_document is not null then now() end,
    case when v_document is not null then now() + interval '30 days' end,
    case when v_document is not null then 'active' end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 5) Defesa em profundidade: mesmo sendo dono da própria linha (RLS
--    profiles_update_own permite UPDATE de qualquer coluna da própria
--    linha), o cliente autenticado NUNCA pode reescrever documento/trial
--    depois de criados. Só o trigger (SECURITY DEFINER, dono da tabela)
--    grava essas colunas.
--    (Esta abordagem de REVOKE por coluna se mostrou ineficaz — ver
--    migration restrict_profiles_update_columns logo em seguida, que
--    corrige o problema real: GRANT ALL de tabela inteira já existente
--    desde o Sprint 1 tornava o REVOKE por coluna um no-op.)
revoke update (document, trial_started_at, trial_ends_at, trial_status)
  on public.profiles from authenticated;
revoke update (document, trial_started_at, trial_ends_at, trial_status)
  on public.profiles from anon;
