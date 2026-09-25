-- MenuNext — área "Clientes" do redesign do painel (referência Stitch).
--
-- Observações internas por cliente: nota curta que a equipe do restaurante
-- escreve sobre um cliente (ex.: "não colocar cebola", preferência de
-- contato), visível só para quem tem acesso à aba Clientes (OWNER — a
-- mesma restrição de requireOwnerPage() já aplicada à página). NUNCA um
-- cadastro de cliente: continua sendo uma tabela auxiliar chaveada por
-- telefone normalizado, o mesmo dado usado como identidade do cliente em
-- aggregateCustomers (src/lib/customers.ts) — não uma FK para uma tabela
-- "customers" que não existe.
--
-- Log de inserção apenas (sem update/delete): o mockup mostra "adicionar
-- nova nota", não editar uma existente — um histórico de anotações é mais
-- simples de implementar corretamente (sem concorrência de edição) e já
-- cobre o caso de uso real.

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_phone text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  note text not null check (length(trim(note)) > 0 and length(note) <= 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index customer_notes_restaurant_phone_idx on public.customer_notes (restaurant_id, customer_phone);

alter table public.customer_notes enable row level security;

-- Só OWNER do restaurante (não STAFF) — mesma regra de acesso da página
-- /painel/clientes (requireOwnerPage) e o mesmo padrão de checagem inline
-- de role já usado nas RPCs de convite (restaurant_invites), já que não
-- existe um helper is_restaurant_owner() no projeto (só is_restaurant_member).
-- auth.uid() envolto em (select ...) — otimização de RLS initplan, mesmo
-- padrão de 20260909193700_optimize_rls_initplan.sql.
create policy "customer_notes_select_owner" on public.customer_notes
  for select to authenticated using (
    exists (
      select 1 from public.restaurant_members m
      where m.restaurant_id = customer_notes.restaurant_id
        and m.user_id = (select auth.uid())
        and m.role = 'OWNER'
    )
  );

create policy "customer_notes_insert_owner" on public.customer_notes
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.restaurant_members m
      where m.restaurant_id = customer_notes.restaurant_id
        and m.user_id = (select auth.uid())
        and m.role = 'OWNER'
    )
  );
