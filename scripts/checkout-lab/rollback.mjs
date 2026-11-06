// Prova, no banco descartavel, que cada rollback de supabase/rollback desfaz a sua migration sem deixar resíduos
// e que as suites ORIGINAIS (sem as funcionalidades novas) voltam a passar depois dele.
import fs from "node:fs";
import path from "node:path";

const OBJECTS = {
  tables: ["product_variants", "support_tickets", "support_messages", "cash_movements", "stock_items", "stock_movements", "stock_settings"],
  functions: [
    "product_variant_create", "product_variant_update", "product_variant_set_available", "product_variant_delete",
    "support_create_ticket", "support_add_message", "support_set_status", "support_set_priority", "support_admin_list",
    "cash_record_movement", "cash_movements_list", "_cash_movement_totals", "cash_session_sales",
    "stock_record_movement", "stock_set_threshold", "stock_set_auto_deduct", "_stock_consume_item", "_stock_restore_item",
    "_stock_trg_order_item", "_stock_trg_order_cancel",
  ],
  triggers: ["stock_consume_after_item_insert", "stock_restore_after_cancel"],
};

export function runRollback({ root, sql, file, suites }) {
  const dir = path.join(root, "supabase/rollback");
  if (!fs.existsSync(dir)) return [];
  const downs = fs.readdirSync(dir).filter((f) => f.endsWith(".down.sql")).sort().reverse(); // mais novo primeiro
  const log = [];
  for (const name of downs) {
    file(path.join(dir, name));
    log.push(`aplicado ${name}`);
  }
  const quote = (l) => l.map((x) => `'${x}'`).join(",");
  const left = sql(`select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${quote(OBJECTS.tables)})) as tabelas,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${quote(OBJECTS.functions)})) as funcoes,
    (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in (${quote(OBJECTS.triggers)})) as gatilhos;`);
  if (!/\b0\s*\|\s*0\s*\|\s*0\b/.test(left)) throw new Error(`rollback deixou residuos:\n${left}`);
  log.push("sem tabelas, funcoes ou gatilhos residuais");
  // O que existia ANTES das migrations novas precisa continuar funcionando: caixa original, pedidos, papeis, isolamento.
  const total = suites(["cash_sessions.sql", "roles_owner_staff.sql", "tenant_isolation.sql", "automatic_promotions.sql", "table_privileges.sql"]);
  log.push(`suites originais apos o rollback: ${total} verificacoes`);
  return log;
}
