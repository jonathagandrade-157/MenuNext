import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { buildContentSecurityPolicy, generateNonce } from "@/lib/csp";

const PROTECTED_PREFIXES = ["/painel", "/onboarding", "/master"];

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Renova a sessão Supabase a cada request e faz a checagem OTIMISTA de
 * autenticação para /painel e /onboarding. Esta é uma camada de UX, não a
 * autorização real: cada Server Action e cada tabela protegida por RLS
 * valida novamente (ver src/lib/supabase/server.ts e as policies em
 * supabase/migrations). O Next.js 16 recomenda não tratar o Proxy como
 * mecanismo único de autorização.
 */
export async function proxy(request: NextRequest) {
  // Content-Security-Policy por requisição. Produção: vale de verdade e com nonce de script (o Next lê o nonce
  // do cabeçalho da REQUISIÇÃO e o aplica sozinho a todos os scripts da página). Desenvolvimento: só relatório,
  // sem nonce (o recarregamento ao vivo usa conexões que a política bloquearia).
  const isProd = process.env.NODE_ENV === "production";
  const nonce = isProd ? generateNonce() : undefined;
  const csp = buildContentSecurityPolicy({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, isDev: !isProd, nonce });
  const cspHeaderName = isProd ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  // Rede de segurança do e-mail de redefinição de senha: se o endereço de retorno não estiver na lista permitida do
  // Supabase, ele devolve a pessoa para a raiz do site com ?code=. Em vez de uma landing que ignora o código,
  // encaminha para a rota que o troca por uma sessão.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const confirmUrl = new URL("/auth/confirmar", request.url);
    confirmUrl.searchParams.set("code", request.nextUrl.searchParams.get("code") ?? "");
    return NextResponse.redirect(confirmUrl);
  }

  // Sempre parte dos cabeçalhos ATUAIS da requisição (inclui cookies que o Supabase acabou de renovar).
  const nextResponse = () => {
    const requestHeaders = new Headers(request.headers);
    if (nonce) requestHeaders.set("Content-Security-Policy", csp);
    const next = NextResponse.next({ request: { headers: requestHeaders } });
    next.headers.set(cspHeaderName, csp);
    return next;
  };

  let response = nextResponse();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = nextResponse();
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedPath(request.nextUrl.pathname) && !user) {
    // Quem tenta abrir uma página protegida sem sessão já tem conta: cai direto no "Entrar" e, depois do
    // login, volta para a página pedida (validada em lib/safeRedirect.ts; destino inválido é ignorado).
    const redirectUrl = new URL("/cadastro", request.url);
    redirectUrl.searchParams.set("mode", "login");
    redirectUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
