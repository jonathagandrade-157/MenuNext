"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, options: { sitekey: string; theme?: string; action?: string; callback?: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void; "timeout-callback"?: () => void }) => string;
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
 * (`resetKey` muda) o widget é reiniciado. `onToken` entrega o token (ou null) a quem não usa <form action>. Não renderiza nada se a chave pública não estiver configurada.
 */
export function TurnstileWidget({ action, resetKey, onToken }: { action: string; resetKey?: unknown; onToken?: (token: string | null) => void }) {
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    const mount = () => {
      if (!window.turnstile || !container.current || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: SITE_KEY,
        theme: "auto",
        action,
        // Para formulários sem <form action> (ex.: checkout): o token chega por callback e some quando expira/falha.
        callback: (token) => onTokenRef.current?.(token),
        "expired-callback": () => onTokenRef.current?.(null),
        "error-callback": () => onTokenRef.current?.(null),
        "timeout-callback": () => onTokenRef.current?.(null),
      });
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
    if (widgetId.current !== null) {
      onTokenRef.current?.(null); // token anterior já foi gasto
      window.turnstile?.reset(widgetId.current);
    }
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
