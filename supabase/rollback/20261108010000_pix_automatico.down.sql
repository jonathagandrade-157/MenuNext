-- ROLLBACK (NÃO é migration). Desfaz 20261108010000_pix_automatico.
-- ANTES: tire PIX_AUTO_ENABLED do servidor (nenhuma cobrança nova) e espere as pendentes vencerem (30 min).
-- ATENÇÃO: apaga as cobranças Pix registradas, os tokens cifrados e orders.paid_at. Os pagamentos em si continuam
-- na conta Mercado Pago de cada loja (o extrato de lá é a referência para conferência manual depois disso).
drop function if exists public.pix_charge_apply_backend(text, text, numeric, text, text, text);
drop function if exists public.pix_charge_for_sync_backend(text, text, uuid, integer);
drop function if exists public.pix_charge_fail_backend(uuid, text);
drop function if exists public.pix_charge_register_backend(uuid, text, numeric, text, timestamptz);
drop function if exists public.pix_charge_begin_backend(text, uuid, integer);
drop function if exists public.get_order_pix_charge(text, uuid);
drop function if exists public.pix_settings_delete(uuid);
drop function if exists public.pix_settings_set_enabled(uuid, boolean);
drop function if exists public.pix_settings_save_webhook_secret(uuid, text);
drop function if exists public.pix_settings_save(uuid, text, text, text);
drop function if exists public.pix_settings_status(uuid);
alter table public.orders drop column if exists paid_at;
drop table if exists public.order_pix_charges;
drop table if exists public.restaurant_pix_settings;
