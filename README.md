# Ícone Status

Monitoramento público dos serviços de produção da [Ícone Academy](https://www.icone.academy), disponível em [status.icone.academy](https://status.icone.academy).

O Upptime continua responsável pelas verificações, histórico e Issues. A interface pública é um site estático próprio, gerado diretamente de `history/*.yml`, `history/summary.json` e das Issues reais com o label `status`.

## Serviços monitorados

| Grupo | Serviço | Endpoint |
| --- | --- | --- |
| Produtos | Plataforma | `https://www.icone.academy` |
| Infraestrutura | API | `https://api.icone.academy/health/live` |
| Infraestrutura | Banco de dados e cache | `https://api.icone.academy/health/ready` |
| Infraestrutura | Arquivos | `https://files.icone.academy/health` |
| Operações críticas | Pagamentos e webhooks | `https://api.icone.academy/health/operations` |

Os slugs históricos `plataforma-app`, `api-liveness` e `api-health-completo` foram preservados. Stripe não aparece enquanto for apenas stub; o health operacional acompanha Asaas, inbox de webhooks, e-mails e jobs duráveis.

## Estados e atualização

- `Operacional`: última leitura válida do Upptime é `up`.
- `Degradado`: resposta lenta ou corpo público com `"status":"degraded"`.
- `Indisponível`: falha HTTP ou status `down`.
- `Status desconhecido`: histórico ausente, inválido, futuro ou com mais de 15 minutos.

A publicação customizada é acionada após cada execução bem-sucedida do `Uptime CI`. `history/*.yml` define o estado atual; `history/summary.json` é usado apenas para uptime e barras históricas.

## Alertas internos

O workflow `Alertas operacionais` envia e-mail via Resend e mensagem via Telegram:

- indisponibilidade: no primeiro check;
- degradação: somente após confirmação em uma leitura posterior;
- recuperação: apenas se o incidente tiver sido notificado;
- falha de entrega: quatro tentativas com backoff e workflow vermelho.

Configure estes repository secrets, sem versionar destinatários ou credenciais:

| Secret | Uso |
| --- | --- |
| `GH_PAT` | Permite que Issues do Upptime disparem workflows e atualizem histórico |
| `RESEND_API_KEY` | API de envio do Resend |
| `ALERT_EMAIL_FROM` | Remetente verificado, por exemplo `Ícone Status <status@icone.academy>` |
| `ALERT_EMAIL_TO` | Lista separada por vírgula ou ponto e vírgula |
| `TELEGRAM_BOT_TOKEN` | Token do bot |
| `TELEGRAM_CHAT_ID` | ID do chat privado ou grupo |

O `workflow_dispatch` de `Alertas operacionais` envia uma mensagem marcada com `[TESTE]` para os dois canais, sem abrir incidente nem alterar health checks reais. WhatsApp fica fora desta versão.

## Desenvolvimento e verificação

```bash
node --test .github/scripts/status/status.test.mjs
node --test .github/scripts/alerts/dispatcher.test.mjs
node .github/scripts/status/fetch-incidents.mjs incidents.json
node .github/scripts/status/generate-site.mjs
```

O arquivo `incidents.json` local é ignorado pelo Git. O build do Pages sempre busca novamente as Issues reais.

## Workflows mantidos

- `uptime.yml`: verificação a cada cinco minutos e gerenciamento de incidentes;
- `summary.yml`, `graphs.yml` e `response-time.yml`: histórico e gráficos;
- `alerts.yml`: Resend e Telegram;
- `static-site.yml`: testes, build e GitHub Pages customizado.

DNS, `CNAME`, domínio e histórico existentes permanecem inalterados.
