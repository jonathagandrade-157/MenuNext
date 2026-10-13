-- P1-02c — Caminho canônico nas policies de storage.objects (endurecimento).
--
-- As policies de escrita do bucket `restaurant-assets` autorizam pelo restaurante
-- extraído do PRÓPRIO nome do objeto: storage_path_restaurant_id(name). Até aqui a
-- função devolvia `split_part(name, '/', 1)::uuid`, ou seja, qualquer nome cujo
-- primeiro segmento "parseie" como uuid era autorizado — inclusive formas que NÃO são
-- o caminho que o aplicativo gera ({restaurant_id}/...): maiúsculas, chaves, uuid sem
-- hífens e nomes com segmentos '.' ou '..', vazios, com barra invertida ou com '%'.
--
-- O isolamento entre restaurantes não deve depender de como o backend de objetos
-- (arquivos, S3, CDN, navegador) normaliza o caminho depois. Esta migration faz a
-- própria função aceitar SOMENTE a forma canônica que o app gera:
--   <uuid minúsculo com hífens>/<segmento>[/<segmento>...]
-- onde cada segmento é não vazio, começa com letra, número ou '_' e só contém
-- letras, números, '_', '.' e '-'. Qualquer outra forma devolve null — e, como
-- is_restaurant_owner(null)/is_restaurant_member(null) são falsos, todas as policies
-- (insert/update/delete e select por membro) passam a negar.
--
-- Mudança mínima: só o corpo da função. Assinatura, volatilidade, search_path e ACL
-- (EXECUTE só para authenticated) ficam como estão; nenhuma policy é recriada.
-- Caminhos que o app gera continuam válidos:
--   {id}/branding/logo.{ext}, {id}/branding/cover.{ext},
--   {id}/products/{product_id}/{1..5}.{ext}, {id}/banners/{asset}.{ext},
--   {id}/combos/{combo_id}/image.{ext}
--
-- Pré-checagem (deve devolver 0 antes de aplicar em produção):
--   select count(*) from storage.objects where bucket_id = 'restaurant-assets'
--     and name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[A-Za-z0-9_][A-Za-z0-9_.-]*)+$';

create or replace function public.storage_path_restaurant_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  if object_name is null
     or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/[A-Za-z0-9_][A-Za-z0-9_.-]*)+$'
  then
    return null;
  end if;
  return split_part(object_name, '/', 1)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

-- verificação: formas canônicas passam; formas não canônicas devolvem null
do $$
begin
  if public.storage_path_restaurant_id('3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f/branding/logo.png') is null then
    raise exception 'storage_path_canonical: caminho canonico foi recusado';
  end if;
  if public.storage_path_restaurant_id('3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f/../9f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f/x.png') is not null
     or public.storage_path_restaurant_id('3F2B8C9E-1A2B-4C3D-8E9F-0A1B2C3D4E5F/x.png') is not null
     or public.storage_path_restaurant_id('{3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f}/x.png') is not null then
    raise exception 'storage_path_canonical: caminho nao canonico foi aceito';
  end if;
end;
$$;
