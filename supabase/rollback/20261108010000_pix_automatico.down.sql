-- ROLLBACK (NÃO é migration). Desfaz 20261108010000_pix_automatico.
-- ATENÇÃO: apaga as cobranças Pix registradas e os tokens cifrados das lojas. Os pagamentos em si continuam na
-- conta Mercado Pago de cada loja. Antes de rodar, desligue PIX_AUTO_ENABLED no servidor.
drop function if exists public.pix_charge_apply_backend(text, text, numeric, text);
drop function if exists public.pix_charge_for_sync_backend(text, text, uuid, integer);
drop function if exists public.pix_charge_register_backend(uuid, text, numeric, text, timestamptz);
drop function if exists public.pix_charge_context_backend(text, uuid);
drop function if exists public.get_order_pix_charge(text, uuid);
drop function if exists public.pix_settings_delete(uuid);
drop function if exists public.pix_settings_set_enabled(uuid, boolean);
drop function if exists public.pix_settings_save(uuid, text, text);
drop function if exists public.pix_settings_status(uuid);
alter table public.orders drop column if exists paid_at;
drop table if exists public.order_pix_charges;
drop table if exists public.restaurant_pix_settings;
