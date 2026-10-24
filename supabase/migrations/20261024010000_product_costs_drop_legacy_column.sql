-- MenuNext — custo dos produtos em tabela própria (2/2): remove a coluna antiga products.cost.
--
-- Depois da migration product_costs (1/2) e do aplicativo novo no ar (que lê o custo de product_costs e
-- nunca de products.cost), a coluna antiga só serve para vazar: products tem leitura pública (cardápio),
-- então qualquer visitante lia o custo e a margem do restaurante. Aqui ela some.
--
-- Segurança da operação: antes de apagar, a migration confere que TODO custo existente em products.cost
-- tem cópia idêntica em product_costs; se algum não tiver, ABORTA sem apagar nada. A constraint
-- products_cost_check cai junto com a coluna (o limite cost >= 0 vive agora em product_costs).

do $$
begin
  if exists (
    select 1 from public.products p
    where p.cost is not null
      and not exists (select 1 from public.product_costs c where c.product_id = p.id and c.cost = p.cost)
  ) then
    raise exception 'product_costs_drop_legacy_column: ha custo em products.cost sem copia identica em product_costs'
      using errcode = '55000';
  end if;
end $$;

alter table public.products drop column cost;
