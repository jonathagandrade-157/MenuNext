-- MenuNext — Fase 3.2: leitura pública de adicionais (detalhe do produto).
--
-- Inspeção prévia: addon_groups/addons/product_addon_groups (Fase 2.3) só
-- têm policies "to authenticated" via is_restaurant_member() — nenhum
-- acesso público existia ainda, deliberadamente adiado para esta fase (ver
-- comentário da Fase 2.3: "a estrutura pública deve estar preparada para
-- que, na próxima fase, um produto possa abrir seu detalhe e carregar os
-- grupos de adicionais reais").
--
-- Reaproveita o mesmo padrão da Fase 3.1 (nenhum USING(true)):
-- `is_restaurant_publicly_visible(restaurant_id)` já existe (migration
-- fix_public_read_restaurant_visibility_check) e é reutilizado aqui sem
-- alteração.
--
-- Diferença importante em relação a products/combos: lá, itens indisponíveis
-- continuam visíveis (para a UI mostrar "indisponível" na listagem). Aqui,
-- o cliente está efetivamente ESCOLHENDO adicionais para comprar — por
-- isso a policy já filtra grupo ativo e adicional disponível na origem, em
-- vez de expor tudo e confiar só no frontend para esconder (item 5 do
-- prompt: "Não buscar todos os adicionais do restaurante e filtrar apenas
-- no frontend").

create policy "addon_groups_select_public" on public.addon_groups
  for select to anon, authenticated
  using (is_active = true and public.is_restaurant_publicly_visible(restaurant_id));

-- addons também exige que o grupo pai esteja ativo (não só o próprio
-- adicional disponível) — um adicional não deve "vazar" publicamente se o
-- grupo dele foi desativado, mesmo que o item em si continue is_available.
create policy "addons_select_public" on public.addons
  for select to anon, authenticated
  using (
    is_available = true
    and public.is_restaurant_publicly_visible(restaurant_id)
    and exists (
      select 1 from public.addon_groups g
      where g.id = addons.addon_group_id and g.is_active = true
    )
  );

create policy "product_addon_groups_select_public" on public.product_addon_groups
  for select to anon, authenticated
  using (public.is_restaurant_publicly_visible(restaurant_id));
