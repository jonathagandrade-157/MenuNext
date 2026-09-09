import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Sempre cria uma instância nova por request (recomendação do @supabase/ssr).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Chamado a partir de um Server Component (sem acesso de escrita
            // a cookies). O proxy.ts já cuida de renovar a sessão a cada
            // request, então é seguro ignorar aqui — ver docs do @supabase/ssr.
          }
        },
      },
    }
  );
}
