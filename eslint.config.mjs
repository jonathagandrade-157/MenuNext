import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Verificações manuais em navegador real (Playwright é dependência externa, instalada à parte).
    "scripts/turnstile-browser/**",
    "scripts/stack-lab/**", // laboratório sintético de ponta a ponta (scripts Node/Playwright, fora do app)
  ]),
]);

export default eslintConfig;
