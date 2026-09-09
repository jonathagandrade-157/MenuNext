import Link from "next/link";
import { LinkButton } from "@/components/ui/Button";

const NAV_LINKS = [
  { label: "Recursos", href: "#recursos" },
  { label: "Como Funciona", href: "#como-funciona" },
  { label: "Planos", href: "#planos" },
  { label: "FAQ", href: "#faq" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface-card/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
        <Link href="/" className="text-lg font-extrabold text-graphite">
          Menu<span className="text-primary">Next</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-semibold text-text-muted hover:text-graphite">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/painel" className="hidden text-sm font-semibold text-graphite hover:text-primary sm:block">
            Entrar
          </Link>
          <LinkButton href="/cadastro" size="sm">
            Criar minha loja grátis
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
