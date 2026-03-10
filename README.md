# Ícone Status

Página de status em tempo real dos serviços da [Ícone Academy](https://icone.academy), gerada automaticamente pelo [Upptime](https://upptime.js.org).

**URL pública:** https://status.icone.academy

---

## Setup (uma única vez)

### 1. Criar o repositório no GitHub

Crie um repositório **público** chamado `icone-status` na sua organização/usuário do GitHub.

> ⚠️ Precisa ser **público** para o GitHub Pages funcionar no plano gratuito.

### 2. Editar `.upptime.yml`

Abra o arquivo `.upptime.yml` e substitua `GITHUB_ORG` pelo seu usuário ou org do GitHub:

```yaml
owner: meneeses
repo: icone-status
assignees:
  - meneeses
```

### 3. Criar o Personal Access Token (PAT)

1. Acesse: https://github.com/settings/tokens/new
2. Nome: `UPPTIME_ICONE`
3. Expiration: **No expiration** (ou 1 year — lembre de renovar)
4. Scopes obrigatórios:

   - ✅ `repo` (acesso completo ao repositório)
   - ✅ `workflow` (permissão para criar/atualizar workflows)

5. Copie o token gerado (começa com `ghp_...`)

### 4. Adicionar o token como secret no repositório

1. No GitHub: `Settings` → `Secrets and variables` → `Actions`
2. Clique em **New repository secret**
3. Nome: `GH_PAT`
4. Valor: cole o token copiado no passo anterior
5. Salve

### 5. Ativar o GitHub Pages

1. No GitHub: `Settings` → `Pages`
2. Source: **GitHub Actions**
3. Salve

### 6. Fazer o primeiro push

```bash
cd D:\src\icone-status
git init
git add -A
git commit -m "chore: initial Upptime setup"
git branch -M master
git remote add origin https://github.com/SEU_USUARIO/icone-status.git
git push -u origin master
```

O GitHub Actions vai rodar automaticamente e em ~2 minutos a página estará gerada.

### 7. Configurar o domínio `status.icone.academy`

No painel DNS do domínio `icone.academy`, adicione:

```
Tipo:   CNAME
Nome:   status
Valor:  SEU_USUARIO.github.io
TTL:    3600
```

> Após a propagação DNS (até 24h), a página estará acessível em `status.icone.academy`.

---

## Serviços monitorados

| Serviço               | URL                                   | Intervalo |
| --------------------- | ------------------------------------- | --------- |
| Plataforma (App)      | https://icone.academy                 | 5 min     |
| API — Liveness        | https://api.icone.academy/health/live | 5 min     |
| API — Health Completo | https://api.icone.academy/health      | 5 min     |

---

## Como funciona

```
A cada 5 minutos:
  GitHub Actions → faz requisição HTTP para cada serviço
                 → registra status e tempo de resposta
                 → cria/fecha Issues automaticamente (incidentes)
                 → atualiza a página de status

A cada hora:
  GitHub Actions → gera gráficos de tempo de resposta (SVG)

A cada push:
  GitHub Actions → reconstrói a página estática (GitHub Pages)
```

---

## Gerenciar incidentes

Incidentes são gerenciados via **GitHub Issues**:

- Issue criada automaticamente quando um serviço cai
- Issue fechada automaticamente quando o serviço se recupera
- Para criar um incidente manual: abra uma Issue com o label `status`
- Incidentes aparecem automaticamente na página pública

---

## Estrutura gerada pelo Upptime

Após o primeiro run, o Upptime vai criar automaticamente:

```
history/          ← histórico de status por serviço (JSON)
graphs/           ← gráficos de uptime e tempo de resposta (SVG)
.github/
  ISSUE_TEMPLATE/ ← templates de incidentes
README.md         ← atualizado automaticamente com badges de uptime
```

---

Powered by [Upptime](https://upptime.js.org) · [MIT License](https://opensource.org/licenses/MIT)
