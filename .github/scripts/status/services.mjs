export const SERVICE_GROUPS = [
  {
    key: "products",
    label: "Produtos",
    description: "Experiências usadas por clientes e pela equipe.",
  },
  {
    key: "infrastructure",
    label: "Infraestrutura",
    description: "API, dependências essenciais e entrega de arquivos.",
  },
  {
    key: "operations",
    label: "Operações críticas",
    description: "Fluxos assíncronos que mantêm a operação funcionando.",
  },
];

export const SERVICES = [
  {
    slug: "plataforma-app",
    name: "Plataforma",
    description: "Site e aplicação principal",
    group: "products",
    url: "https://www.icone.academy",
  },
  {
    slug: "api-liveness",
    name: "API",
    description: "Disponibilidade do processo da API",
    group: "infrastructure",
    url: "https://api.icone.academy/health/live",
  },
  {
    slug: "api-health-completo",
    name: "Banco de dados e cache",
    description: "Dependências necessárias para atender tráfego",
    group: "infrastructure",
    url: "https://api.icone.academy/health/ready",
    healthDetails: true,
  },
  {
    slug: "arquivos",
    name: "Arquivos",
    description: "Upload e distribuição de arquivos",
    group: "infrastructure",
    url: "https://files.icone.academy/health",
  },
  {
    slug: "pagamentos-e-webhooks",
    name: "Pagamentos e webhooks",
    description: "Asaas, webhooks, e-mails e jobs de cobrança",
    group: "operations",
    url: "https://api.icone.academy/health/operations",
    healthDetails: true,
  },
];

export const SERVICE_BY_SLUG = new Map(SERVICES.map((service) => [service.slug, service]));
