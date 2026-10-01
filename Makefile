.PHONY: dev test lint build migrate migrate-down migrate-status

dev:
	pnpm dev

test:
	pnpm test

lint:
	pnpm lint

build:
	pnpm build

migrate:
	pnpm --filter @jdrive/api db:migrate

migrate-down:
	@echo 'Drizzle Kit não faz rollback automático. Implemente e revise um down migration explícito; nenhum dado será removido por este target.'
	@exit 2

migrate-status:
	pnpm --filter @jdrive/api db:status
