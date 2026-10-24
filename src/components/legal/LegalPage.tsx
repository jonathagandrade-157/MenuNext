import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY, LEGAL_LAST_UPDATED } from "@/lib/legal";
import type { LegalSection } from "@/lib/legalContent";

/** Casca das páginas legais (/privacidade e /termos): cabeçalho simples, sumário e
 * seções. Funciona do celular ao desktop; o sumário vira uma coluna lateral em lg. */
export function LegalPage({
  title,
  intro,
  sections,
  otherPage,
}: {
  title: string;
  intro: string[];
  sections: LegalSection[];
  otherPage: { href: string; label: string };
}) {
  const tocSections = sections.filter((s) => /^\d+\./.test(s.title));

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-surface-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-body-lg font-extrabold text-graphite">
            Menu<span className="text-primary">Next</span>
          </Link>
          <Link href={otherPage.href} className="text-label-lg text-primary hover:underline">
            {otherPage.label}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10 lg:py-12">
        <nav aria-label="Sumário" className="mb-8 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <p className="mb-2 text-label-sm uppercase text-text-muted">Neste documento</p>
          <ul className="space-y-1.5">
            {tocSections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-body-sm text-text-muted hover:text-primary">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article>
          <h1 className="text-headline-lg text-graphite">{title}</h1>
          <p className="mt-1 text-body-sm text-text-muted">Última atualização: {LEGAL_LAST_UPDATED}</p>

          <div className="mt-5 space-y-3">
            {intro.map((p) => (
              <p key={p} className="text-body-md text-graphite">
                {p}
              </p>
            ))}
          </div>

          {sections.map((section) => {
            const isSub = !/^\d+\./.test(section.title);
            return (
              <section key={section.id} id={section.id} className="scroll-mt-6 pt-8">
                {isSub ? (
                  <h3 className="text-body-lg font-bold text-graphite">{section.title}</h3>
                ) : (
                  <h2 className="text-headline-sm text-graphite">{section.title}</h2>
                )}
                <div className="mt-2 space-y-3">
                  {section.paragraphs?.map((p) => (
                    <p key={p} className="text-body-md text-graphite">
                      {p}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="list-disc space-y-1.5 pl-5 text-body-md text-graphite marker:text-primary">
                      {section.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {section.after?.map((p) => (
                    <p key={p} className="text-body-md text-graphite">
                      {p}
                    </p>
                  ))}
                  {section.id === "contato" && <ContactBlock />}
                </div>
              </section>
            );
          })}
        </article>
      </main>
    </div>
  );
}

function ContactBlock() {
  return (
    <div className="rounded-xl border border-border bg-surface-card p-4 text-body-md text-graphite">
      <p className="font-semibold">{LEGAL_ENTITY.name}</p>
      {LEGAL_ENTITY.cnpj && <p>CNPJ: {LEGAL_ENTITY.cnpj}</p>}
      {LEGAL_ENTITY.address && <p>{LEGAL_ENTITY.address}</p>}
      {LEGAL_ENTITY.dpoName && <p>Encarregado pelo tratamento de dados (DPO): {LEGAL_ENTITY.dpoName}</p>}
      {LEGAL_CONTACT_EMAIL ? (
        <p>
          E-mail:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-semibold text-primary underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
      ) : (
        <p className="text-text-muted">
          Use o contato de suporte informado no seu painel ou o WhatsApp do estabelecimento onde fez o pedido.
        </p>
      )}
    </div>
  );
}
