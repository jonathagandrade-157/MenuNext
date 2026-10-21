import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditRoleLabel, getMasterAudit, getRestaurantAudit, parseAuditPage } from "./audit";

const fakeClient = (result: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };

describe("auditRoleLabel", () => {
  it("traduz os papéis e cai em Sistema quando não há autor", () => {
    expect(auditRoleLabel("OWNER")).toBe("Proprietário");
    expect(auditRoleLabel("STAFF")).toBe("Equipe");
    expect(auditRoleLabel("MASTER")).toBe("Master");
    expect(auditRoleLabel(null)).toBe("Sistema");
    expect(auditRoleLabel("OUTRO")).toBe("OUTRO");
  });
});

describe("parseAuditPage", () => {
  it("aceita inteiros positivos e ignora lixo", () => {
    expect(parseAuditPage("3")).toBe(3);
    expect(parseAuditPage(["2", "9"])).toBe(2);
    expect(parseAuditPage("0")).toBe(1);
    expect(parseAuditPage("-4")).toBe(1);
    expect(parseAuditPage("1.5")).toBe(1);
    expect(parseAuditPage("abc")).toBe(1);
    expect(parseAuditPage(undefined)).toBe(1);
  });
});

describe("getRestaurantAudit", () => {
  it("devolve as linhas da função e passa o limite", async () => {
    const rows = [{ created_at: "2026-10-21T10:00:00Z", actor_name: "Dona A", actor_role: "OWNER", action: "update", entity: "products", summary: "x" }];
    const client = fakeClient({ data: rows, error: null });
    expect(await getRestaurantAudit(client, 5)).toEqual(rows);
    expect(client.rpc).toHaveBeenCalledWith("restaurant_audit_recent", { p_limit: 5 });
  });

  it("erro vira lista vazia (a auditoria nunca derruba a tela)", async () => {
    expect(await getRestaurantAudit(fakeClient({ data: null, error: { message: "boom" } }))).toEqual([]);
  });
});

describe("getMasterAudit", () => {
  const row = (n: number) => ({
    created_at: `2026-10-21T10:0${n}:00Z`, restaurant_id: "r1", restaurant_name: "Loja", actor_name: "A", actor_role: "OWNER",
    action: "update", entity: "products", summary: `s${n}`, total: "120",
  });

  it("calcula o deslocamento pela página, tira o total das linhas e o devolve à parte", async () => {
    const client = fakeClient({ data: [row(1), row(2)], error: null });
    const result = await getMasterAudit(client, { page: 3, limit: 50, restaurantId: "r1" });
    expect(client.rpc).toHaveBeenCalledWith("master_audit_list", { p_limit: 50, p_offset: 100, p_restaurant: "r1" });
    expect(result.total).toBe(120);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).not.toHaveProperty("total");
  });

  it("sem linhas ou com erro, devolve vazio e total 0", async () => {
    expect(await getMasterAudit(fakeClient({ data: [], error: null }))).toEqual({ rows: [], total: 0 });
    expect(await getMasterAudit(fakeClient({ data: null, error: { message: "x" } }))).toEqual({ rows: [], total: 0 });
  });
});
