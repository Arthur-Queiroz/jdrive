# Technology Stack

## Frontend

- Svelte
- Vite
- TypeScript

Reasoning:

- Lightweight static output
- Simple reactive UI
- Good fit for upload progress
- Easy responsive design
- Minimal runtime overhead

## Backend

- Node.js
- TypeScript
- Fastify

Reasoning:

- Lightweight HTTP framework
- Strong TypeScript ecosystem
- Good streaming support
- Multipart upload support
- Suitable for a small API

## Database

- PostgreSQL

The application must reuse the existing PostgreSQL server running on the VPS.

Create a dedicated:

- Database, preferably `jdrive`
- Application user with access limited to the JDrive database

## ORM

- Drizzle ORM
- Drizzle Kit

Responsibilities:

- Typed schema
- Query construction
- Migrations
- Schema evolution

## Authentication

- Password hashing: Argon2id
- Session authentication
- Secure HTTP-only cookie

## Reverse Proxy / TLS

- Caddy

Must follow the same conventions used by the existing `vps-infra` setup.

## Deployment

- Docker Compose
- Persistent host-mounted storage
- Existing PostgreSQL instance

## Explicitly Not Used in MVP

- Redis
- MongoDB
- Prisma
- TypeORM
- NestJS
- Nuxt
- S3-compatible storage
