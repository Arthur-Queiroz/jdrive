# JDrive

Aplicação privada de transferência de arquivos pessoais. Envie um arquivo num dispositivo e acesse-o em outro, sem armazenamento terceirizado. Os bytes ficam no filesystem persistente da VPS; o PostgreSQL guarda apenas autenticação e metadados.

## Escopo do MVP

Login privado, upload por seletor ou arrastar/soltar, fila com progresso individual (até dois envios simultâneos), busca parcial sem diferenciar maiúsculas/minúsculas, download transmitido em streaming, exclusão com confirmação e indicador de uso. Limites padrão: 1 GiB por arquivo e 10 GiB no total. Sem compartilhamento público, pastas, previews, sync, S3 ou serviços extras.

## Stack e arquitetura

- Svelte 5 + Vite + TypeScript: SPA estática, servida pelo Fastify na imagem de produção.
- Fastify + TypeScript; PostgreSQL existente via Drizzle ORM/Kit.
- Senhas Argon2id; sessões aleatórias em cookie HttpOnly/Secure/SameSite e hashes HMAC no banco.
- Arquivos em diretórios persistentes fora do rootfs. Nome original nunca é caminho físico; só UUID validado é resolvido.
- Um processo/container; sem Redis, filas ou banco dedicado.

## Desenvolvimento local

Requisitos: Node.js 22+ e pnpm 11+.

1. Crie um banco PostgreSQL e um usuário dedicados (`jdrive` / `jdrive_app`) no PostgreSQL existente ou local. O app não cria nem altera roles/databases.
2. Configure as variáveis em `.env` (partindo de `.env.example`): `DATABASE_URL`, `SESSION_SECRET` (32+ caracteres) e `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD` (16+ caracteres na primeira execução). **Não envie segredos por chat ou commit.**
3. Execute:

```sh
cp .env.example .env
# edite o .env local com valores reais; ele é ignorado pelo Git
pnpm install
pnpm dev
```

Vite: `http://localhost:5173`; API: `http://localhost:3000`; login: `/login`. O backend aplica migrações pendentes antes de começar a escutar. O usuário inicial é inserido somente se a tabela `users` estiver vazia; trocar as variáveis depois não redefine a senha. Depois do primeiro bootstrap, remova `ADMIN_INITIAL_PASSWORD` do `.env`.

Para comandos individuais: `pnpm dev:api` e `pnpm dev:web`. A SPA usa o proxy Vite para `/api`.

## Comandos

```sh
pnpm lint       # TypeScript + svelte-check
pnpm test       # testes API/fluxo com DB fake e testes dos utilitários UI
pnpm build      # API + SPA de produção
make migrate    # aplica migrations pendentes usando DATABASE_URL
make migrate-status
make migrate-down # bloqueia por segurança: Drizzle não gera rollback reversível
```

`make migrate-down` não executa DDL destrutivo. Para reverter uma migration de produção, planeje e revise SQL de rollback/backup especificamente para aquela versão.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---:|---|
| `DATABASE_URL` | — | PostgreSQL dedicado ao app; obrigatório para iniciar |
| `SESSION_SECRET` | — | HMAC das sessões; obrigatório em todos os ambientes (mín. 32 bytes) |
| `ADMIN_USERNAME` | — | usuário criado no primeiro boot quando DB sem usuários |
| `ADMIN_INITIAL_PASSWORD` | — | senha bootstrap (mín. 16; retirar após criação) |
| `SESSION_TTL_DAYS` | `7` | validade de sessão (1–30 dias) |
| `MAX_FILE_SIZE_MB` | `1024` | limite por arquivo |
| `MAX_STORAGE_GB` | `10` | limite total |
| `FILES_DIR` | `data/files` | diretório persistente dos bytes |
| `TMP_DIR` | `data/tmp` | temporários, separado do diretório final |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | listener interno |

## Container e VPS

`Dockerfile` produz uma imagem única, não-root (`10001:10001`), rootfs compatível com modo read-only e sem porta publicada. `compose.yaml` serve somente para desenvolvimento local; persistência é `./data`, e a publicação local fica em `127.0.0.1`.

Produção deve seguir o golden path existente: manifesto em `Arthur-Queiroz/vps-infra`, PostgreSQL compartilhado com database/role dedicados, rede interna + edge/Caddy/Cloudflare Tunnel e release por digest via reusable workflow `Arthur-Queiroz/vps-deploy`. Não usar Docker Compose como deploy nem expor porta pública. O primeiro usuário precisa de bootstrap seguro. A implantação requer provisionar a role/banco, configurar `secrets.env`, permissões do volume para UID 10001, manifesto, hostname/tunnel e GitHub Actions; esses passos ainda precisam de onboarding/verificação no host.

## Verificações e limitações atuais

`pnpm test` cobre os fluxos HTTP com Fastify inject, persistência/metadata com PostgreSQL fake e utilitários UI; habilitando `TEST_DATABASE_URL` com `ALLOW_DESTRUCTIVE_TEST_DB=1`, roda também os testes de migrations e concorrência contra um banco descartável. O CI aplica migrations antes da suite. A imagem e o smoke local de `/health`, `/login` e rejeição da API sem sessão foram testados; deploy na VPS, HTTPS público, persistência após restart e backups ainda dependem do onboarding.

## Specs

Consulte `00-overview.md` até `15-implementation-plan.md`. `13-acceptance-criteria.md` é o checklist funcional de referência; não marque itens de integração/deploy como concluídos sem teste no ambiente real.
