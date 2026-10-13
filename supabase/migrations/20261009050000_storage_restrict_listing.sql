-- P1-02d — Leitura de storage.objects do bucket `restaurant-assets` só para membros.
--
-- A policy restaurant_assets_select_public (TO public) permitia que qualquer visitante
-- sem login LISTASSE os nomes de todos os objetos do bucket pela API de objetos. O app
-- não lista objetos: as imagens são servidas pela URL pública do bucket (rota
-- /object/public/..., que não passa por policy de storage.objects) e o upload usa
-- upsert, que só precisa enxergar as linhas do próprio restaurante.
--
-- Esta migration troca a policy pública por uma de leitura restrita a MEMBROS do
-- restaurante dono do caminho. O que NÃO muda: a URL pública das imagens (vitrine,
-- painel, checkout), o upload/substituição/remoção pelo OWNER e a negação para STAFF
-- escrever. Mudança aditiva e reversível (ver rollback privado).

drop policy if exists restaurant_assets_select_public on storage.objects;
drop policy if exists restaurant_assets_select_members on storage.objects;

create policy restaurant_assets_select_members on storage.objects
  for select to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and public.is_restaurant_member(public.storage_path_restaurant_id(name))
  );

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'restaurant_assets_select_public') then
    raise exception 'storage_restrict_listing: policy publica ainda existe';
  end if;
end;
$$;
