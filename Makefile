.PHONY: dev test lint build migrate migrate-down migrate-status

dev:
	pnpm dev:api

test:
	pnpm test

lint:
	pnpm lint

build:
	pnpm build

migrate migrate-down migrate-status:
	pnpm --dir backend drizzle-kit $@
