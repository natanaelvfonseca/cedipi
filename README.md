# CEDIPI Agenda

Demonstração visual do sistema de agenda médica da CEDIPI, construída com React, TypeScript e Vite. Os dados e as interações da agenda ainda são mantidos somente no estado local da aplicação. Um backend Node.js fornece o health check da conexão PostgreSQL.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm ci
npm run dev
```

Em outro terminal, inicie a API local:

```bash
npm run dev:server
```

## PostgreSQL

Copie `.env.example` para `.env` e substitua os valores de exemplo pelas credenciais reais. O arquivo `.env` não é versionado.

Inicialize o banco operacional (o comando pode ser executado novamente com segurança):

```bash
npm run db:bootstrap
```

Execute as migrations versionadas:

```bash
npm run db:migrate
```

Depois de configurar `DATABASE_URL` apontando para `cedipi_core`, valide pela API:

```bash
curl http://localhost:3000/api/health/database
```

### Controle global da Lara no n8n

O painel usa `GET/PATCH /api/ai-control` com a sessão HttpOnly. Integrações server-to-server
consultam somente `GET /api/internal/ai-control`, enviando o segredo configurado em
`N8N_INTERNAL_API_SECRET` no header `x-cedipi-internal-secret`.

O gate do n8n deve continuar apenas quando `globalEnabled === true`. HTTP não-2xx, timeout
ou resposta sem boolean representam falha de integração e não devem ser tratados como pausa
solicitada pelo usuário.

O node `Buscar slots cedipi_core` usa a mesma autenticação interna:

```text
GET /api/internal/scheduling/availability?date=YYYY-MM-DD&doctor=Nome
x-cedipi-internal-secret: valor de N8N_INTERNAL_API_SECRET
```

A rota `/api/scheduling/availability` permanece reservada ao painel autenticado. As duas
rotas executam o mesmo handler e repositório de disponibilidade.

## Build de produção

```bash
npm run build
```

## Docker / Easypanel

A imagem usa build multi-stage e serve a SPA e a API pelo Node.js na porta 3000.

```bash
docker build -t cedipi-agenda .
docker run --rm --env-file .env -p 3000:3000 cedipi-agenda
```

No EasyPanel, configure `DATABASE_URL`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_INSTANCE_ID` e `N8N_INTERNAL_API_SECRET`, e exponha a porta `3000` da aplicação. Use o hostname interno do serviço PostgreSQL. `POSTGRES_ADMIN_URL` só é necessária durante o bootstrap e pode ser removida do serviço após a criação do banco.
