import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthedUser, getCategories, getMyRestaurant } from "@/lib/tenant";
import { NovoProdutoForm } from "@/components/painel/produtos/NovoProdutoForm";
import { EmptyState } from "@/components/ui/States";

export default async function NovoProdutoPage() {
  const { supabase, user } = await getAuthedUser();
  if (!user) redirect("/cadastro");

  const restaurant = await getMyRestaurant(supabase);
  if (!restaurant) redirect("/onboarding/passo-1");

  const categories = await getCategories(supabase, restaurant.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <nav className="flex items-center gap-2 text-xs font-medium text-text-muted">
        <Link href="/painel/produtos" className="hover:text-graphite">
          Produtos
        </Link>
        <span>/</span>
        <span className="font-bold text-graphite">Novo produto</span>
      </nav>

      <div>
        <h1 className="text-2xl font-black tracking-tight text-graphite">Novo produto</h1>
        <p className="mt-0.5 text-sm font-medium text-text-muted">
          Apresente fotos atrativas, defina o preço e escolha a categoria do cardápio.
        </p>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="Crie uma categoria antes de cadastrar produtos."
          description="Todo produto precisa pertencer a uma categoria do cardápio (ex.: Pizzas, Bebidas)."
          action={
            <Link href="/painel/categorias" className="mt-2 text-sm font-semibold text-primary hover:underline">
              Ir para Categorias →
            </Link>
          }
        />
      ) : (
        <NovoProdutoForm categories={categories} />
      )}
    </div>
  );
}
