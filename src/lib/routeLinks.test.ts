import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Guarda de links: todo destino interno escrito no código (href, redirect,
 * router.push/replace) precisa casar com uma rota que existe em src/app.
 * Pega o link quebrado (que cai no 404 ou, pior, num destino errado) antes de
 * ir para produção. `${...}` num template vale como um segmento dinâmico.
 */
const SRC = join(process.cwd(), "src");
const APP = join(SRC, "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const routePatterns = walk(APP)
  .filter((f) => f.endsWith(`${sep}page.tsx`))
  .map((f) => {
    const route = "/" + relative(APP, f).split(sep).slice(0, -1).join("/");
    return route === "/" ? "/" : route;
  });

function matchesRoute(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  return routePatterns.some((pattern) => {
    const p = pattern.split("/").filter(Boolean);
    return p.length === segments.length && p.every((seg, i) => (seg.startsWith("[") ? true : seg === segments[i]));
  });
}

const LINK_PATTERNS: RegExp[] = [
  /href=(?:"|\{`)(\/[^"`}]*)(?:"|`\})/g,
  /href: "(\/[^"]*)"/g,
  /redirect\((?:"|`)(\/[^"`]*)(?:"|`)\)/g,
  /router\.(?:push|replace)\((?:"|`)(\/[^"`]*)(?:"|`)\)/g,
];

function collectLinks(): { file: string; link: string }[] {
  const found: { file: string; link: string }[] = [];
  const sources = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  for (const file of sources) {
    const text = readFileSync(file, "utf-8");
    for (const pattern of LINK_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        found.push({ file: relative(SRC, file), link: m[1] });
      }
    }
  }
  return found;
}

describe("links internos", () => {
  const links = collectLinks();

  it("encontra links para verificar (o scanner não está vazio)", () => {
    expect(routePatterns.length).toBeGreaterThan(20);
    expect(links.length).toBeGreaterThan(30);
  });

  it("todo link, redirect e router.push aponta para uma rota que existe", () => {
    const broken = links
      .map(({ file, link }) => {
        const path = link.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, "x");
        return { file, link, ok: path === "" || matchesRoute(path) };
      })
      .filter((l) => !l.ok);
    expect(broken).toEqual([]);
  });

  it("o logo do menu do painel e do master não leva para a landing page", () => {
    const sidebar = readFileSync(join(SRC, "components/layout/PanelSidebar.tsx"), "utf-8");
    expect(sidebar).not.toMatch(/<Link href="\/"/);
  });
});
