"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, options: { sitekey: string; theme?: string; action?: string }) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __menunextTurnstileReady?: () => void;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Widget Turnstile para formulários com Server Action. O próprio widget grava o token no campo oculto
 * `cf-turnstile-response` do formulário que o contém. Token é de uso único: a cada resposta da ação
 * (`resetKey` muda) o widget é reiniciado. Não renderiza nada se a chave pública não estiver configurada.
 */
export function TurnstileWidget({ action, resetKey }: { action: string; resetKey?: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    const mount = () => {
      if (!window.turnstile || !container.current || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(container.current, { sitekey: SITE_KEY, theme: "auto", action });
    };
    if (window.turnstile) mount();
    else {
      const previous = window.__menunextTurnstileReady;
      window.__menunextTurnstileReady = () => {
        previous?.();
        mount();
      };
    }
    return () => {
      if (widgetId.current !== null) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action]);

  useEffect(() => {
    if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__menunextTurnstileReady"
        strategy="afterInteractive"
      />
      <div ref={container} className="min-h-[65px]" aria-label="Verificação anti-robô" />
    </>
  );
}
