# JDrive — orientações para agentes

Leia nesta ordem: `00-overview.md`, `01-product-requirements.md`, specs relevantes e `15-implementation-plan.md`. Preserve o escopo do MVP.

- Stack definida pelo produto: Svelte/Vite/TypeScript + Fastify/TypeScript + PostgreSQL/Drizzle; não substitua sem aprovação.
- Armazenamento binário local persistente, nunca blobs no banco nem diretório público. Nome original nunca compõe caminho físico.
- Segredos não entram em código, docs, commits ou logs. `.env` não deve ser versionado.
- Mantenha baixo consumo e uma aplicação monolítica; sem serviços novos sem justificativa/consentimento.
- Execute formatação, lint, testes e build antes do commit; use branches `hermes/` (ou convenção da tarefa), nunca implemente em `main`.

Comandos disponíveis: `pnpm build`, `pnpm test`, `pnpm lint`; `make dev`, `make test`, `make lint`, `make build`, `make migrate`, `make migrate-down`, `make migrate-status`.
