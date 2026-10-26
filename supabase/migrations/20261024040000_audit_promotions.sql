-- MenuNext — promoções automáticas entram no registro de auditoria.
--
-- Mesmo critério das outras tabelas de configuração: só ações de pessoas (JWT), só NOMES de colunas
-- alteradas (nunca valores), nunca bloqueia a operação do lojista. O nome da promoção já sai de
-- "name" (padrão da função); falta só o rótulo "Promoção".
--
-- A função audit_row_change NÃO é copiada aqui: esta migration lê a definição que está no banco e troca
-- 1 trecho, exigido EXATAMENTE uma vez (senão aborta sem alterar nada). Mesma assinatura e permissões.

do $patch$
declare
  v_def text;
  v_from text;
  v_to text;
  v_n integer;
begin
  v_def := replace(pg_get_functiondef('public.audit_row_change()'::regprocedure), chr(13), '');

  v_from := replace($f$      when 'coupons' then 'Cupom'
$f$, chr(13), '');
  v_to := replace($t$      when 'coupons' then 'Cupom'
      when 'promotions' then 'Promoção'
$t$, chr(13), '');

  v_n := (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from);
  if v_n <> 1 then
    raise exception 'audit_row_change mudou: trecho aparece % vez(es) (esperado 1); nada foi alterado', v_n using errcode = '55000';
  end if;

  execute replace(v_def, v_from, v_to);
end
$patch$;

create trigger audit_promotions after insert or update or delete on public.promotions
  for each row execute function public.audit_row_change();
