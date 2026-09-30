# JDrive

Aplicação pessoal de transferência e armazenamento de arquivos. As especificações do MVP estão nos arquivos numerados na raiz; a ordem de execução está em `15-implementation-plan.md`.

## Stack

Svelte + Vite + TypeScript (SPA), Fastify + TypeScript, PostgreSQL/Drizzle (a configurar), armazenamento persistente no filesystem. A stack Svelte/Fastify foi explicitamente definida nas specs do produto.

## Desenvolvimento

Requisitos: Node.js 22+ e pnpm 11+.

```sh
cp .env.example .env # ajuste DATABASE_URL; nunca faça commit do .env
pnpm install
pnpm dev:api
pnpm dev:web
```

O frontend Vite está em `http://localhost:5173`, API em `http://localhost:3000`; `/health` é o health check inicial. Comandos `pnpm build`, `pnpm test`, `pnpm lint`; `make dev`, `make test`, `make lint`, `make build`, `make migrate`, `make migrate-down` e `make migrate-status` são atalhos de projeto.

## Docker

`Dockerfile` e `compose.yaml` são ponto de partida; o serviço ainda não entrega o build estático do frontend e não deve ser tratado como deployment pronto. O goal precisa completar e validar a composição antes de qualquer deploy. Configure `.env` e armazenamento persistente; Caddy e migrações ficam para as fases especificadas.

## Status

Bootstrap técnico inicial para iniciar o goal. A tela Svelte é apenas visual e não autentica; apenas `/health` existe na API. Não há banco, login nem operações de arquivo implementadas ainda.
