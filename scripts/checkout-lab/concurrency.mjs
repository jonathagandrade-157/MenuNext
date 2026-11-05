// Concorrencia REAL no banco descartavel: varias sessoes psql simultaneas (o SQL de uma transacao so nao prova corrida).
// Chamado por run.mjs depois das suites. Dados sinteticos; o cluster inteiro e removido ao terminar.
import { randomUUID } from "node:crypto";

const SESSIONS = 16;

export async function runConcurrency({ sql, parallel }) {
  const lines = [];
  const check = (cond, message) => {
    if (!cond) throw new Error(`concorrencia: ${message}`);
  };
  const scalar = (query) => sql(query).split("\n").map((l) => l.trim()).find((l) => /^-?\d+$/.test(l));

  const r = randomUUID(), cat = randomUUID(), prod = randomUUID(), order = randomUUID();
  const item = randomUUID();
  sql(`
    insert into public.restaurants (id, name, slug) values ('${r}', 'Conc', 'conc-${r.slice(0, 8)}');
    insert into public.categories (id, restaurant_id, name, display_order) values ('${cat}', '${r}', 'c', 1);
    insert into public.products (id, restaurant_id, name, price, category_id, display_order) values ('${prod}', '${r}', 'p', 10, '${cat}', 1);
    insert into public.stock_items (product_id, restaurant_id, quantity) values ('${prod}', '${r}', 100);
    insert into public.orders (id, restaurant_id, order_number, customer_name, customer_phone, fulfillment_type, payment_method, subtotal, total, status, idempotency_key)
      values ('${order}', '${r}', 1, 'c', '11999990001', 'pickup', 'cash', 50, 50, 'received', 'conc-1');
    insert into public.order_items (id, restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
      values ('${item}', '${r}', '${order}', '${prod}', 'p', 10, 5, 50);
    insert into public.stock_settings (restaurant_id, auto_deduct) values ('${r}', true);`);
  check(scalar(`select quantity from public.stock_items where product_id = '${prod}'`) === "100", "estado inicial do saldo");

  // 1) o MESMO item baixado por 16 sessoes ao mesmo tempo: exatamente uma baixa
  let out = await parallel(Array.from({ length: SESSIONS }, () => `select public._stock_consume_item('${item}')`));
  check(out.filter((o) => o === "t").length === 1, `esperava 1 baixa verdadeira, vieram ${out.filter((o) => o === "t").length}`);
  check(scalar(`select quantity from public.stock_items where product_id = '${prod}'`) === "95", "saldo deveria ser 95 apos baixa unica");
  check(scalar(`select count(*) from public.stock_movements where order_item_id = '${item}' and kind = 'sale'`) === "1", "deveria haver 1 movimento de venda");
  lines.push(`baixa simultanea do mesmo item (${SESSIONS} sessoes): 1 baixa, saldo 95`);

  // 2) o MESMO estorno em 16 sessoes: exatamente um estorno
  out = await parallel(Array.from({ length: SESSIONS }, () => `select public._stock_restore_item('${item}')`));
  check(out.filter((o) => o === "t").length === 1, `esperava 1 estorno verdadeiro, vieram ${out.filter((o) => o === "t").length}`);
  check(scalar(`select quantity from public.stock_items where product_id = '${prod}'`) === "100", "saldo deveria voltar a 100");
  lines.push(`estorno simultaneo (${SESSIONS} sessoes): 1 estorno, saldo 100`);

  // 3) itens DISTINTOS do mesmo produto baixados em paralelo: nenhuma atualizacao perdida
  const ids = Array.from({ length: SESSIONS }, () => randomUUID());
  sql(`insert into public.order_items (id, restaurant_id, order_id, product_id, product_name, unit_price, quantity, subtotal)
       select x, '${r}', '${order}', '${prod}', 'p', 10, 1, 10 from unnest(array[${ids.map((i) => `'${i}'::uuid`).join(",")}]) x;`);
  // os gatilhos de insercao ja baixaram 16 de forma serial; devolve e refaz em paralelo para provar a trava de linha
  const before = scalar(`select quantity from public.stock_items where product_id = '${prod}'`);
  check(before === "84", `os 16 gatilhos seriais deveriam ter baixado 16 (saldo ${before})`);
  sql(`update public.orders set status = 'cancelled' where id = '${order}'`); // estorna tudo (inclui o item de 5 ja revertido: no-op)
  check(scalar(`select quantity from public.stock_items where product_id = '${prod}'`) === "100", "cancelar o pedido deveria devolver os 16");
  sql(`delete from public.stock_movements where kind in ('sale','sale_reversal')`);
  sql(`update public.stock_items set quantity = 100 where product_id = '${prod}'; update public.orders set status = 'received' where id = '${order}';`);
  out = await parallel(ids.map((i) => `select public._stock_consume_item('${i}')`));
  check(out.filter((o) => o === "t").length === SESSIONS, `todas as ${SESSIONS} baixas distintas deveriam acontecer (vieram ${out.filter((o) => o === "t").length})`);
  check(scalar(`select quantity from public.stock_items where product_id = '${prod}'`) === "84", "saldo deveria ser 100 - 16 = 84 (sem atualizacao perdida)");
  check(scalar(`select sum(delta) from public.stock_movements where product_id = '${prod}'`) === "-16", "livro deveria somar -16");
  lines.push(`${SESSIONS} baixas distintas simultaneas: saldo 84, livro -16, sem atualizacao perdida`);

  // 4) baixa e cancelamento do pedido ao mesmo tempo: saldo final coerente com o livro
  await parallel([
    ...ids.slice(0, 8).map((i) => `select public._stock_restore_item('${i}')`),
    ...ids.slice(0, 8).map((i) => `select public._stock_consume_item('${i}')`),
  ]);
  const balance = scalar(`select quantity from public.stock_items where product_id = '${prod}'`);
  const ledger = scalar(`select 100 + coalesce(sum(delta), 0) from public.stock_movements where product_id = '${prod}'`);
  check(balance === ledger && Number(balance) >= 0, `saldo (${balance}) difere do livro (${ledger})`);
  lines.push(`baixa x estorno concorrentes: saldo ${balance} = livro ${ledger}`);
  return lines;
}
