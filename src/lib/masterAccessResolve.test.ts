import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/masterGuard", () => ({ assertMasterMfa: async () => {}, assertMasterNetwork: async () => {} }));

import { getPlatformRequireAal2, isPlatformAdmin, resolveMasterAccess } from "./tenant";

const rpcClient = (map: Record<string, { data?: unknown; error?: { code?: string; message?: string } | null }>) =>
  ({ rpc: async (fn: string) => map[fn] ?? { data: null, error: { code: "PGRST202", message: "x" } } }) as never;

describe("resolveMasterAccess", () => {
  it("usa o estado decidido pelo banco", async () => {
    for (const state of ["admin", "mfa_required", "not_admin"] as const) {
      expect(await resolveMasterAccess(rpcClient({ platform_admin_state: { data: state, error: null } }))).toBe(state);
    }
  });
  it("valor desconhecido do banco = não administrador (falha fechado)", async () => {
    for (const weird of ["root", "", null, true, undefined]) {
      expect(await resolveMasterAccess(rpcClient({ platform_admin_state: { data: weird, error: null } })), String(weird)).toBe("not_admin");
    }
  });
  it("sem a migration cai no is_platform_admin original", async () => {
    expect(await resolveMasterAccess(rpcClient({ is_platform_admin: { data: true, error: null } }))).toBe("admin");
    expect(await resolveMasterAccess(rpcClient({ is_platform_admin: { data: false, error: null } }))).toBe("not_admin");
  });
  it("outro erro do banco não vira acesso: propaga", async () => {
    await expect(resolveMasterAccess(rpcClient({ platform_admin_state: { error: { code: "XX000", message: "boom" } } }))).rejects.toBeTruthy();
  });
});

describe("getPlatformRequireAal2 / isPlatformAdmin", () => {
  it("estado, indisponível sem a migration, erro propagado", async () => {
    expect(await getPlatformRequireAal2(rpcClient({ platform_get_require_aal2: { data: true, error: null } }))).toBe(true);
    expect(await getPlatformRequireAal2(rpcClient({ platform_get_require_aal2: { data: false, error: null } }))).toBe(false);
    expect(await getPlatformRequireAal2(rpcClient({}))).toBeNull();
    await expect(getPlatformRequireAal2(rpcClient({ platform_get_require_aal2: { error: { code: "XX000", message: "boom" } } }))).rejects.toBeTruthy();
  });
  it("isPlatformAdmin exige true exato", async () => {
    expect(await isPlatformAdmin(rpcClient({ is_platform_admin: { data: "true", error: null } }))).toBe(false);
  });
});
