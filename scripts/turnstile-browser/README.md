# Verificação do Turnstile em navegador real

Requer acesso a `challenges.cloudflare.com` e Playwright/Chromium. As chaves públicas são **embutidas no build**; os segredos são do servidor.
Chaves de teste oficiais (públicas): sites `1x00000000000000000000AA` (sempre aprova), `2x00000000000000000000AB` (sempre reprova),
`3x00000000000000000000FF` (força desafio interativo); segredos `1x/2x/3x0000000000000000000000000000000AA`.
Atrás de proxy, o servidor Next precisa de `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca>` para falar com a Cloudflare.

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA npx next start -p 3000 &
BASE_URL=http://127.0.0.1:3000 EXPECT=pass node scripts/turnstile-browser/turnstile-browser.cjs      # pass | invalid (segredo 2x) | expired (segredo 3x)
MODE=interactive|blocking BASE_URL=... node scripts/turnstile-browser/turnstile-widget-modes.cjs       # site 3x / 2x
```
