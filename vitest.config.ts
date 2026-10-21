import path from "node:path";
import { defineConfig } from "vitest/config";

// Mesmo alias do tsconfig (`@/` -> `src/`), para testar Server Actions e rotas
// que importam por alias. Os testes de lib continuam usando caminhos relativos.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
