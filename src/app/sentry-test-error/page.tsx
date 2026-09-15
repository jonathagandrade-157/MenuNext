// Rota temporária só para validar a instrumentação do Sentry (JON-21) —
// lança um erro real e determinístico ao ser carregada, capturado por
// onRequestError (src/instrumentation.ts). Sem isso, validar com "acessar
// algo que não existe" seria ambíguo: um 404 do Next.js é uma resposta
// intencional (notFound()), não uma exceção não tratada, e normalmente não
// gera evento no Sentry. Remover esta rota depois da validação.
//
// force-dynamic: sem isso o Next.js tenta pré-renderizar a página no
// build (ela não depende de nada dinâmico) e o throw quebra o build
// inteiro, em vez de só acontecer quando alguém de fato visitar a rota.
export const dynamic = "force-dynamic";

export default function SentryTestErrorPage() {
  throw new Error("JON-21: erro de teste para validar a instrumentação do Sentry no MenuNext.");
}
