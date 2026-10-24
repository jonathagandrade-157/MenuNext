/**
 * Texto das páginas /privacidade e /termos. Cada afirmação aqui descreve algo
 * que o sistema de fato faz (ver src/lib/legal.ts para o que falta preencher).
 * Se o produto mudar — novo fornecedor, novo dado coletado, nova cobrança —
 * o texto precisa mudar junto, e LEGAL_LAST_UPDATED também.
 */

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Parágrafos depois da lista. */
  after?: string[];
};

export const PRIVACY_INTRO = [
  "Esta Política de Privacidade explica como o MenuNext trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD) e o Marco Civil da Internet (Lei nº 12.965/2014).",
  "O MenuNext é uma plataforma que permite a restaurantes ter um cardápio digital, receber pedidos diretamente de seus clientes e gerenciar a operação. Por isso, existem dois grupos de pessoas cujos dados tratamos: os restaurantes e suas equipes (quem usa o painel) e os clientes dos restaurantes (quem faz pedidos nas lojas). O papel do MenuNext é diferente em cada caso, e explicamos isso abaixo.",
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "papeis",
    title: "1. Quem decide sobre os seus dados (controlador e operador)",
    paragraphs: [
      "Para os dados da conta do restaurante e de sua equipe (cadastro, login, assinatura), o MenuNext é o controlador: nós decidimos como e por que esses dados são tratados.",
      "Para os dados dos clientes que fazem pedidos em uma loja, o controlador é o restaurante dono da loja. Ele decide para que usar o nome, o telefone e o endereço de quem pediu. O MenuNext atua como operador: trata esses dados em nome do restaurante, apenas para fornecer a plataforma, e não os usa para publicidade própria nem os vende.",
      "Se você é cliente de um restaurante e quer exercer seus direitos sobre um pedido, o caminho mais direto é falar com o próprio restaurante. Você também pode falar conosco (seção 9), e encaminharemos ou atenderemos a solicitação conforme o caso.",
    ],
  },
  {
    id: "dados",
    title: "2. Quais dados tratamos",
    paragraphs: ["Dados do restaurante e de sua equipe:"],
    bullets: [
      "Cadastro: nome, e-mail, telefone e senha (a senha é guardada de forma protegida pelo nosso provedor de autenticação; nós não a vemos).",
      "Dados do estabelecimento: nome, endereço, documento (CPF ou CNPJ), telefone/WhatsApp de contato, logotipo, fotos, horários, formas de pagamento aceitas e regras de entrega.",
      "Dados de assinatura: plano contratado, situação de pagamento e identificadores da cobrança junto ao processador de pagamentos. Não armazenamos número de cartão.",
      "Registros de uso e segurança: ações administrativas registradas na plataforma e registros técnicos de acesso (como endereço IP, data e hora e informações do navegador), mantidos por nós e por nossos provedores de infraestrutura para segurança, prevenção a fraudes e cumprimento de obrigação legal.",
    ],
    after: ["Dados dos clientes que fazem pedidos em uma loja:"],
  },
  {
    id: "dados-clientes",
    title: "Dados do pedido",
    bullets: [
      "Nome e telefone (WhatsApp) informados no pedido.",
      "Para entrega: CEP, rua, número, complemento, bairro, cidade, UF e ponto de referência. A partir do endereço calculamos coordenadas geográficas para estimar a distância e a taxa de entrega.",
      "Itens pedidos, valores, forma de pagamento, valor do troco, cupom usado e observações escritas por você.",
      "Situação do pedido (recebido, em preparo, entregue etc.) e horários de cada etapa.",
    ],
    after: [
      "Não pedimos criação de conta nem senha ao cliente final. Não coletamos dados sensíveis (como saúde ou religião). Se você escrever uma informação desse tipo no campo de observações (por exemplo, uma alergia), ela será vista pelo restaurante para preparar o pedido; escreva apenas o necessário.",
    ],
  },
  {
    id: "finalidades",
    title: "3. Para que usamos os dados e em que base legal",
    bullets: [
      "Prestar o serviço: criar e manter a conta, exibir a loja, receber e acompanhar pedidos, calcular entrega e emitir comandas. Base legal: execução de contrato (LGPD, art. 7º, V).",
      "Cobrar a assinatura dos restaurantes e controlar o acesso conforme a situação do pagamento. Base legal: execução de contrato.",
      "Manter a segurança da plataforma, prevenir fraudes e abusos e investigar incidentes. Base legal: legítimo interesse (art. 7º, IX) e, quando exigido, cumprimento de obrigação legal ou regulatória (art. 7º, II).",
      "Guardar registros de acesso pelo prazo exigido pelo Marco Civil da Internet. Base legal: obrigação legal.",
      "Responder a solicitações de titulares e a autoridades. Base legal: obrigação legal e exercício regular de direitos.",
      "Enviar avisos sobre o serviço (cobrança, mudanças, segurança). Base legal: execução de contrato e legítimo interesse.",
    ],
    after: [
      "Não vendemos dados pessoais, não fazemos perfis para publicidade de terceiros e não usamos os dados dos clientes dos restaurantes para marketing do MenuNext.",
    ],
  },
  {
    id: "compartilhamento",
    title: "4. Com quem compartilhamos",
    paragraphs: [
      "Compartilhamos dados apenas na medida necessária para a plataforma funcionar, com os seguintes tipos de destinatário:",
    ],
    bullets: [
      "O restaurante dono da loja, que recebe os dados dos pedidos feitos nela (e os de sua equipe, nos limites do papel de cada pessoa).",
      "Infraestrutura e hospedagem: Vercel (hospedagem da aplicação) e Supabase (banco de dados e autenticação).",
      "Processamento de pagamentos de assinatura: Asaas e/ou Mercado Pago, que recebem os dados necessários para cobrar o restaurante. Os pagamentos dos pedidos dos clientes (Pix, dinheiro ou cartão na entrega) acontecem diretamente com o restaurante; o MenuNext não os processa nem os custodia.",
      "Serviços de apoio ao pedido: Google (geocodificação do endereço de entrega, para calcular distância e frete) e ViaCEP (consulta do endereço a partir do CEP, que recebe apenas o CEP).",
      "Monitoramento de erros: Sentry, para identificarmos falhas técnicas. Configuramos a ferramenta para remover dados pessoais conhecidos dos relatórios.",
      "Autoridades públicas, quando houver obrigação legal ou ordem judicial.",
    ],
    after: [
      "Ao clicar em um botão de WhatsApp, você é levado ao aplicativo do WhatsApp, que tem a própria política de privacidade.",
    ],
  },
  {
    id: "transferencia",
    title: "5. Transferência internacional",
    paragraphs: [
      "Alguns dos fornecedores acima mantêm servidores fora do Brasil. Quando isso acontece, a transferência é feita para atender à prestação do serviço e com fornecedores que adotam medidas de segurança e garantias compatíveis com a LGPD (art. 33).",
    ],
  },
  {
    id: "retencao",
    title: "6. Por quanto tempo guardamos",
    bullets: [
      "Dados da conta do restaurante: enquanto a conta estiver ativa. Após o encerramento, guardamos o mínimo necessário pelos prazos legais (por exemplo, obrigações fiscais e de defesa em processos) e depois eliminamos ou anonimizamos.",
      "Dados dos pedidos: o restaurante, como controlador, define a finalidade; mantemos enquanto a conta estiver ativa e pelos prazos legais aplicáveis, e eliminamos quando o restaurante pedir ou a conta for encerrada, ressalvadas as obrigações legais.",
      "Registros de acesso: no mínimo 6 meses, conforme o Marco Civil da Internet.",
    ],
  },
  {
    id: "direitos",
    title: "7. Seus direitos",
    paragraphs: ["Pela LGPD (art. 18), você pode pedir, a qualquer momento:"],
    bullets: [
      "confirmação de que tratamos seus dados e acesso a eles;",
      "correção de dados incompletos, inexatos ou desatualizados;",
      "anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei;",
      "portabilidade dos dados, nos termos da regulamentação;",
      "eliminação dos dados tratados com base em consentimento;",
      "informação sobre com quem compartilhamos seus dados;",
      "informação sobre a possibilidade de não consentir e suas consequências;",
      "revogação do consentimento, quando essa for a base legal;",
      "revisão de decisões tomadas apenas por tratamento automatizado. Não tomamos decisões desse tipo sobre você.",
    ],
    after: [
      "Responderemos à confirmação e ao acesso nos prazos da lei (a declaração completa em até 15 dias). Para sua segurança, podemos pedir informações para confirmar que você é a pessoa titular dos dados.",
      "Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD) se entender que seus direitos não foram respeitados.",
    ],
  },
  {
    id: "seguranca",
    title: "8. Segurança da informação",
    paragraphs: [
      "Adotamos medidas técnicas e organizacionais para proteger os dados contra acesso não autorizado, perda e alteração. Entre elas:",
    ],
    bullets: [
      "conexão criptografada (HTTPS) em toda a plataforma;",
      "isolamento entre restaurantes no banco de dados: cada restaurante só acessa os próprios dados, com regras aplicadas no próprio banco e não só na tela;",
      "separação de papéis dentro do painel (proprietário e equipe), com permissões diferentes;",
      "autenticação protegida e senhas nunca armazenadas em texto aberto;",
      "validação de assinaturas nos avisos automáticos dos processadores de pagamento;",
      "monitoramento de erros e registros para investigação de incidentes.",
    ],
    after: [
      "Nenhum sistema é totalmente imune a falhas. Se ocorrer um incidente de segurança que possa causar risco ou dano relevante, comunicaremos os titulares afetados e a ANPD nos termos e prazos da regulamentação.",
    ],
  },
  {
    id: "cookies",
    title: "9. Cookies e armazenamento no navegador",
    paragraphs: [
      "Usamos apenas o que é necessário para o funcionamento: um cookie de sessão para manter o restaurante conectado ao painel e o armazenamento local do navegador para guardar a sua sacola de compras na loja, para que ela não se perca ao navegar. Não usamos cookies de publicidade nem ferramentas de análise de audiência de terceiros. Você pode limpar esses dados nas configurações do navegador; a sacola será esvaziada e, no painel, será preciso entrar de novo.",
    ],
  },
  {
    id: "menores",
    title: "10. Crianças e adolescentes",
    paragraphs: [
      "O painel do MenuNext é destinado a maiores de 18 anos ou representantes legais de estabelecimentos. Não direcionamos o serviço a crianças e adolescentes.",
    ],
  },
  {
    id: "contato",
    title: "11. Como falar conosco",
    paragraphs: [
      "Para exercer seus direitos, tirar dúvidas ou reportar um problema de privacidade, use o contato abaixo. Se for cliente de um restaurante, você também pode falar diretamente com ele.",
    ],
  },
  {
    id: "alteracoes",
    title: "12. Mudanças nesta política",
    paragraphs: [
      "Podemos atualizar esta política quando o serviço ou a lei mudarem. A data da última atualização fica no topo desta página; em mudanças relevantes para os restaurantes, avisaremos pelo painel ou por e-mail.",
    ],
  },
];

export const TERMS_INTRO = [
  "Estes Termos de Uso regulam o uso da plataforma MenuNext pelos restaurantes e suas equipes. Ao criar uma conta ou usar o painel, você declara que leu e concorda com eles e com a Política de Privacidade.",
  "Quem apenas faz um pedido em uma loja (cliente final) não precisa criar conta no MenuNext; a compra é feita com o restaurante, e o tratamento dos dados está descrito na Política de Privacidade.",
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "servico",
    title: "1. O que é o MenuNext",
    paragraphs: [
      "O MenuNext é uma plataforma de software (SaaS) que oferece ao restaurante um cardápio digital com link próprio, recebimento de pedidos, painel de acompanhamento, cálculo de entrega, cupons e cadastro de clientes.",
      "O MenuNext não é restaurante, não vende nem entrega alimentos e não é parte da venda entre o restaurante e seu cliente. Cada restaurante é o único responsável pelos produtos, preços, prazos, entrega, atendimento e obrigações fiscais, sanitárias e de consumo relativas às suas vendas.",
    ],
  },
  {
    id: "conta",
    title: "2. Conta e acesso",
    bullets: [
      "A conta deve ser criada por pessoa maior de 18 anos e com poderes para representar o estabelecimento.",
      "Você deve informar dados verdadeiros e mantê-los atualizados.",
      "Você é responsável por guardar suas credenciais e por tudo que for feito com a sua conta. Avise-nos se suspeitar de uso indevido.",
      "O proprietário pode convidar pessoas da equipe e define o que elas podem fazer. Ele responde pelos atos delas na plataforma.",
    ],
  },
  {
    id: "planos",
    title: "3. Teste grátis, planos e cobrança",
    bullets: [
      "Novas contas têm um período de teste gratuito, informado no cadastro. Ao fim do teste, o acesso só continua com a contratação de um plano.",
      "Os planos e seus valores são apresentados no painel antes da contratação. A assinatura é recorrente e cobrada por meio de processadores de pagamento parceiros (Asaas e/ou Mercado Pago).",
      "O MenuNext não cobra comissão sobre os pedidos feitos nas lojas. O pagamento dos pedidos é feito diretamente ao restaurante (Pix, dinheiro ou cartão na entrega); o MenuNext não processa, retém nem repassa esses valores.",
      "Se a assinatura ficar em atraso, for cancelada ou o teste terminar sem plano contratado, o acesso ao painel e a loja pública ficam indisponíveis até a regularização. Os dados são preservados durante esse período.",
      "Você pode cancelar a assinatura a qualquer momento pelos canais indicados no painel. O cancelamento vale para as cobranças futuras; valores já pagos de períodos em curso não são reembolsados, salvo exigência legal.",
      "Podemos alterar preços e planos, avisando com antecedência. A alteração só vale para as cobranças posteriores ao aviso.",
    ],
  },
  {
    id: "uso",
    title: "4. Regras de uso",
    paragraphs: ["Você se compromete a usar a plataforma de forma lícita e, em especial, a não:"],
    bullets: [
      "cadastrar produtos, textos ou imagens ilegais, enganosos, ofensivos ou que violem direitos de terceiros;",
      "tentar acessar dados de outros restaurantes, burlar controles de segurança ou sobrecarregar o serviço;",
      "usar os dados dos clientes para fins diferentes dos informados a eles ou em desacordo com a LGPD;",
      "copiar, revender ou fazer engenharia reversa da plataforma;",
      "usar a plataforma para fraude, spam ou qualquer atividade ilícita.",
    ],
  },
  {
    id: "dados",
    title: "5. Dados dos seus clientes",
    paragraphs: [
      "Os dados dos clientes que pedem na sua loja pertencem à relação entre você e eles. Você é o controlador desses dados (LGPD) e o MenuNext é o operador. Isso significa que você deve ter uma base legal para usá-los, usar apenas para atender pedidos e comunicar-se sobre eles, respeitar os direitos dos titulares e não utilizá-los de forma incompatível com a lei.",
      "O MenuNext trata esses dados apenas para prestar o serviço, conforme a Política de Privacidade.",
    ],
  },
  {
    id: "conteudo",
    title: "6. Conteúdo que você publica",
    paragraphs: [
      "Fotos, textos, logotipos, preços e demais conteúdos da sua loja continuam sendo seus. Você nos concede licença limitada, não exclusiva e sem custo, apenas para hospedá-los e exibi-los na sua loja e no painel. Você declara ter os direitos necessários sobre esse conteúdo, inclusive de imagem e de marca, e responde por ele.",
      "As imagens enviadas podem ser redimensionadas e convertidas de formato para economizar espaço e acelerar o carregamento.",
    ],
  },
  {
    id: "propriedade",
    title: "7. Propriedade intelectual do MenuNext",
    paragraphs: [
      "O software, o design, a marca MenuNext e a documentação são do MenuNext. O contrato dá a você apenas o direito de usar a plataforma enquanto estiver ativo, sem transferir qualquer propriedade.",
    ],
  },
  {
    id: "disponibilidade",
    title: "8. Disponibilidade e suporte",
    paragraphs: [
      "Trabalhamos para manter a plataforma disponível, mas não garantimos que ela funcione sem interrupções ou erros. Podem ocorrer manutenções e falhas de internet, de fornecedores ou de causas fora do nosso controle. Recomendamos que o restaurante tenha um plano alternativo para receber pedidos (por exemplo, telefone ou WhatsApp) caso a plataforma fique indisponível.",
      "O suporte é prestado pelos canais informados no painel.",
    ],
  },
  {
    id: "responsabilidade",
    title: "9. Limitação de responsabilidade",
    paragraphs: [
      "Dentro do que a lei permite, o MenuNext não responde por lucros cessantes, perda de vendas ou danos indiretos decorrentes de indisponibilidade, por atos do restaurante com seus clientes, por informações incorretas cadastradas pelo restaurante, nem por falhas de serviços de terceiros.",
      "Quando houver responsabilidade do MenuNext, ela se limita ao valor pago pelo restaurante nos 12 meses anteriores ao fato que a originou. Nada nestes Termos exclui responsabilidades que a lei não permite excluir.",
    ],
  },
  {
    id: "encerramento",
    title: "10. Suspensão e encerramento",
    bullets: [
      "Você pode encerrar a conta quando quiser.",
      "Podemos suspender ou encerrar contas que violem estes Termos ou a lei, ou que coloquem a plataforma ou terceiros em risco, avisando sempre que possível.",
      "Depois do encerramento, você pode solicitar uma cópia dos dados do seu estabelecimento. Eliminamos ou anonimizamos os dados conforme a Política de Privacidade, respeitados os prazos legais.",
    ],
  },
  {
    id: "alteracoes",
    title: "11. Alterações dos Termos",
    paragraphs: [
      "Podemos atualizar estes Termos. Em mudanças relevantes, avisaremos pelo painel ou por e-mail com antecedência razoável. Continuar usando a plataforma depois do aviso significa que você aceita a nova versão; se não concordar, pode cancelar a conta.",
    ],
  },
  {
    id: "lei",
    title: "12. Lei aplicável e foro",
    paragraphs: [
      "Estes Termos são regidos pelas leis do Brasil. Fica eleito o foro da comarca da sede do MenuNext para resolver conflitos, ressalvado o foro do consumidor quando a lei assim determinar.",
    ],
  },
  {
    id: "contato",
    title: "13. Contato",
    paragraphs: ["Dúvidas sobre estes Termos podem ser enviadas pelo contato abaixo."],
  },
];
