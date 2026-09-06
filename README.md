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

No EasyPanel, configure `DATABASE_URL`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` e `EVOLUTION_INSTANCE_ID`, e exponha a porta `3000` da aplicação. Use o hostname interno do serviço PostgreSQL. `POSTGRES_ADMIN_URL` só é necessária durante o bootstrap e pode ser removida do serviço após a criação do banco.
