import { describe, expect, it } from "vitest";
import {
  allVariantsUnavailable,
  defaultVariantId,
  getProductVariantsForStore,
  getStoreVariants,
  resolveVariantChoice,
  variantFromPrice,
  variantItemName,
  type PublicVariant,
} from "./storeVariants";
import { buildBagItemKey, createBagItem } from "./bag";
import { buildOrderItemsPayload } from "./checkout";
import { friendlyOrderError } from "./orderErrors";
import type { SupabaseClient } from "@supabase/supabase-js";

const v = (id: string, price: number, isAvailable = true, name = id): PublicVariant => ({ id, productId: "p1", name, price, isAvailable });
const P = v("p", 35, true, "Pequena");
const M = v("m", 55.5, true, "Média");
const G = v("g", 70, false, "Grande");

describe("variantes — regras puras (as mesmas de create_order)", () => {
  it("produto sem variantes: escolha vazia é válida e não há variante", () => {
    expect(resolveVariantChoice([], null)).toEqual({ ok: true, variant: null });
    expect(resolveVariantChoice([], "qualquer")).toEqual({ ok: true, variant: null });
  });
  it("produto com variantes exige escolha", () => {
    const r = resolveVariantChoice([P, M, G], null);
    expect(r.ok).toBe(false);
  });
  it("variante desligada ou inexistente é recusada", () => {
    expect(resolveVariantChoice([P, M, G], "g").ok).toBe(false);
    expect(resolveVariantChoice([P, M, G], "x").ok).toBe(false);
  });
  it("variante válida é devolvida", () => {
    expect(resolveVariantChoice([P, M, G], "m")).toEqual({ ok: true, variant: M });
  });
  it("'a partir de' ignora as desligadas; nenhuma disponível = null", () => {
    expect(variantFromPrice([M, G, P])).toBe(35);
    expect(variantFromPrice([G])).toBeNull();
    expect(variantFromPrice([])).toBeNull();
    expect(allVariantsUnavailable([G])).toBe(true);
    expect(allVariantsUnavailable([])).toBe(false);
    expect(allVariantsUnavailable([G, P])).toBe(false);
  });
  it("pré-seleciona só quando há exatamente uma disponível", () => {
    expect(defaultVariantId([P, G])).toBe("p");
    expect(defaultVariantId([P, M])).toBeNull();
    expect(defaultVariantId([G])).toBeNull();
  });
  it("nome do item igual ao gravado pelo banco", () => {
    expect(variantItemName("Pizza", "Média")).toBe("Pizza — Média");
    expect(variantItemName("Pizza", null)).toBe("Pizza");
  });
});

describe("sacola e payload com variante", () => {
  it("sem variante: chave, nome e payload idênticos aos de antes", () => {
    const item = createBagItem({ productId: "p1", name: "Suco", basePrice: 8, imageUrl: null, quantity: 2, observation: "", selectedAddons: [] });
    expect(item.key).toBe("p1::::");
    expect(item.key).toBe(buildBagItemKey("p1", [], ""));
    expect(item.name).toBe("Suco");
    expect("variantId" in item).toBe(false);
    expect(buildOrderItemsPayload([item])).toEqual([{ product_id: "p1", quantity: 2, observation: null, addon_ids: [] }]);
  });
  it("com variante: preço da variante, nome composto, chave distinta e variant_id no payload (sem preço)", () => {
    const media = createBagItem({
      productId: "p1", name: "Pizza", basePrice: 55.5, imageUrl: null, quantity: 2, observation: "",
      selectedAddons: [{ groupId: "g", addonId: "a1", name: "Borda", price: 5 }], variant: { id: "m", name: "Média" },
    });
    const pequena = createBagItem({
      productId: "p1", name: "Pizza", basePrice: 35, imageUrl: null, quantity: 1, observation: "", selectedAddons: [], variant: { id: "p", name: "Pequena" },
    });
    expect(media.name).toBe("Pizza — Média");
    expect(media.subtotal).toBe(121);
    expect(media.variantId).toBe("m");
    expect(media.variantName).toBe("Média");
    expect(media.key).not.toBe(pequena.key);
    expect(media.key).not.toBe(buildBagItemKey("p1", ["a1"], ""));
    const payload = buildOrderItemsPayload([media, pequena]);
    expect(payload).toEqual([
      { product_id: "p1", quantity: 2, observation: null, addon_ids: ["a1"], variant_id: "m" },
      { product_id: "p1", quantity: 1, observation: null, addon_ids: [], variant_id: "p" },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/price|subtotal/);
  });
  it("sacola antiga salva sem variantId continua gerando o payload de sempre", () => {
    const legacy = { key: "p1::::", productId: "p1", name: "Pizza", basePrice: 40, imageUrl: null, quantity: 1, observation: "", selectedAddons: [], subtotal: 40 };
    expect(buildOrderItemsPayload([legacy])).toEqual([{ product_id: "p1", quantity: 1, observation: null, addon_ids: [] }]);
  });
});

describe("mensagens de erro de variante (create_order)", () => {
  it("cada código tem mensagem própria, sem cair na genérica", () => {
    const generic = friendlyOrderError("algo");
    for (const code of ["variant_required", "variant_not_found", "variant_unavailable"]) {
      const msg = friendlyOrderError(`ERROR: ${code}`);
      expect(msg).not.toBe(generic);
      expect(msg).toMatch(/opç/);
    }
    expect(friendlyOrderError("variant_required")).toMatch(/adicione de novo/);
    // códigos antigos intactos
    expect(friendlyOrderError("product_unavailable")).toMatch(/indisponível/);
  });
});

/** Cliente falso: devolve o resultado configurado e registra os filtros aplicados. */
function fakeClient(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: { table: string; filters: [string, unknown][] } = { table: "", filters: [] };
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => { calls.filters.push([col, val]); return builder; },
    order: () => builder,
    limit: () => Promise.resolve(result),
  };
  const client = { from: (t: string) => { calls.table = t; return builder; } } as unknown as SupabaseClient;
  return { client, calls };
}

describe("leitura das variantes na loja", () => {
  it("filtra pela loja E pelo produto e converte o preço", async () => {
    const { client, calls } = fakeClient({ data: [{ id: "m", product_id: "p1", name: "Média", price: "55.50", is_available: true }], error: null });
    const list = await getProductVariantsForStore(client, "r1", "p1");
    expect(calls.table).toBe("product_variants");
    expect(calls.filters).toEqual([["restaurant_id", "r1"], ["product_id", "p1"]]);
    expect(list).toEqual([{ id: "m", productId: "p1", name: "Média", price: 55.5, isAvailable: true }]);
  });
  it("banco sem a migration (tabela ausente) ou visitante sem permissão: lista vazia, loja de sempre", async () => {
    for (const error of [
      { code: "42P01", message: 'relation "public.product_variants" does not exist' },
      { code: "PGRST205", message: "Could not find the table 'public.product_variants'" },
      { code: "42501", message: "permission denied for table product_variants" },
    ]) {
      expect(await getProductVariantsForStore(fakeClient({ data: null, error }).client, "r1", "p1")).toEqual([]);
      expect(await getStoreVariants(fakeClient({ data: null, error }).client, "r1")).toEqual([]);
    }
  });
  it("outros erros não são engolidos", async () => {
    await expect(getStoreVariants(fakeClient({ data: null, error: { code: "57014", message: "timeout" } }).client, "r1")).rejects.toBeTruthy();
  });
});
