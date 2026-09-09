const FOOTER_COLUMNS = [
  {
    title: "Produto",
    links: ["Cardápio Digital", "Painel Gerencial", "Pedidos em Tempo Real", "Tabela de Preços"],
  },
  {
    title: "Empresa",
    links: ["Sobre o MenuNext", "Histórias de Sucesso", "Vagas e Carreiras", "Programa de Parceiros"],
  },
  {
    title: "Suporte",
    links: ["Central de Ajuda", "Vídeos e Tutoriais", "Perguntas Frequentes", "Contato com Consultor"],
  },
  {
    title: "Legal",
    links: ["Termos de Uso", "Privacidade e LGPD", "Segurança da Informação"],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-graphite text-white">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-6 py-16 md:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div className="space-y-3">
          <p className="text-lg font-extrabold">
            Menu<span className="text-primary">Next</span>
          </p>
          <p className="max-w-xs text-sm text-white/60">
            A plataforma de pedidos online e painel gerencial para restaurantes que querem vender direto, sem
            intermediários.
          </p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title} className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-white/40">{column.title}</p>
            <ul className="space-y-2">
              {column.links.map((link) => (
                <li key={link} className="text-sm text-white/70 hover:text-white">
                  {link}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-6 py-6 text-center text-xs text-white/40">
        © {new Date().getFullYear()} MenuNext Tecnologia para Gastronomia Ltda. Todos os direitos reservados.
      </div>
    </footer>
  );
}
