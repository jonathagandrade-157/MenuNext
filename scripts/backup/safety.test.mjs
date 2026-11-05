import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSourceRole } from "./backup-db.mjs";
import { assertStorageTarget } from "./restore-storage.mjs";
import { syncExternal } from "./sync-external.mjs";
import { backupStamp, buildManifest, sha256File, writeManifest } from "./lib.mjs";

describe("defesas de backup revisadas na nuvem", () => {
  it.each([
    "backup_ro|f|f|f|f|t|on|NaN|0",
    "backup_ro|f|f|f|f|t|on|-1|0",
    "backup_ro|f|f|f|f|t|on||0",
    "backup_ro|?|f|f|f|t|on|0|0",
    "|f|f|f|f|t|on|0|0",
  ])("recusa resposta malformada da sonda: %s", (line) => {
    expect(evaluateSourceRole(line).ok).toBe(false);
  });

  const ref = "abcdefghijklmnopqrst";
  it.each([
    `http://${ref}.supabase.co`,
    `https://${ref}.supabase.co:8443`,
    `https://user:password@${ref}.supabase.co`,
    `https://${ref}.supabase.co/other-project`,
    `https://${ref}.supabase.co?redirect=other`,
  ])("recusa destino remoto inseguro antes de usar credenciais: %s", (url) => {
    expect(() => assertStorageTarget(url, { allowRemoteRef: ref })).toThrow(/Recusado/);
  });

  it("aceita HTTPS remoto confirmado e loopback IPv4/IPv6", () => {
    expect(assertStorageTarget(`https://${ref}.supabase.co`, { allowRemoteRef: ref })).toEqual({ local: false, ref });
    expect(assertStorageTarget("http://127.0.0.1:54321")).toEqual({ local: true });
    expect(assertStorageTarget("http://[::1]:54321")).toEqual({ local: true });
  });

  it("preserva copias antigas quando a sincronizacao encontra um arquivo corrompido", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "menunext-retention-safety-"));
    try {
      const src = path.join(root, "src");
      const dest = path.join(root, "dest");
      await fs.mkdir(src);
      await fs.mkdir(dest);
      const oldNames = [];
      for (const date of ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]) {
        const name = `menunext-db-${backupStamp(new Date(date))}.dump.gpg`;
        oldNames.push(name);
        await fs.writeFile(path.join(dest, name), "cifrado-sintetico");
      }
      const name = "menunext-db-20261105T000000Z.dump.gpg";
      await fs.writeFile(path.join(src, name), "cifrado-sintetico");
      await writeManifest(src, buildManifest({ kind: "db", file: name, bytes: 17, sha256: await sha256File(path.join(src, name)) }));
      await fs.writeFile(path.join(src, name), "corrompido");
      const result = await syncExternal({ srcDir: src, destDir: dest, allowSameVolume: true, now: new Date("2026-11-05T12:00:00Z") });
      expect(result.failed).toHaveLength(1);
      expect(result.pruned).toEqual([]);
      expect(await fs.readdir(dest)).toEqual(oldNames);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
