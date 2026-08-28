# CEDIPI Agenda

Demonstração visual do sistema de agenda médica da CEDIPI, construída com React, TypeScript e Vite. Os dados e as interações são mantidos somente no estado local da aplicação.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm ci
npm run dev
```

## Build de produção

```bash
npm run build
```

## Docker / Easypanel

A imagem usa build multi-stage e serve a SPA com Nginx na porta 80.

```bash
docker build -t cedipi-agenda .
docker run --rm -p 8080:80 cedipi-agenda
```

Não há backend, banco de dados ou integrações externas nesta demonstração.
