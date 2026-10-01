# Goal para implementar o JDrive

Use este texto ao iniciar `/goal` no Hermes (na conversa do gateway/Telegram):

```text
Implemente o JDrive deste repositório conforme as specs numeradas da raiz e a ordem em 15-implementation-plan.md. Primeiro confira git status/branch e leia AGENTS.md, README.md, overview, requisitos, arquitetura e specs relevantes. O repo foi preparado para a implementação; não presuma que o protótipo atual já cumpre requisitos.

Trabalhe fase a fase, fechando fatias funcionais testáveis em commits pequenos na branch hermes/* (nunca main). Preserve a stack bloqueada pelas specs: Svelte/Vite/TypeScript, Fastify/TypeScript, PostgreSQL/Drizzle, Argon2id e filesystem; reuse PostgreSQL existente, não crie infra compartilhada. Não faça deploy nem altere VPS. Nunca registre ou publique secrets. Se depender de credenciais/decisão/infra externa indisponível, documente o bloqueio e avance em itens independentes.

Antes de encerrar cada fase: rode pnpm lint, pnpm test, pnpm build; acrescente testes que validem comportamento real, não aceite suíte vazia. Para banco, use migrações Drizzle versionadas; não use AutoMigrate. Teste fluxos de API com autenticação, limites de tamanho/capacidade, streaming, limpeza de temporários e persistência. Atualize specs/README com status somente quando a evidência cumprir os critérios. Não marque fase implementada apenas por compilação.

verify: pnpm lint && pnpm test && pnpm build; testes de API/UI relevantes passando e evidência de smoke test local da aplicação. Faça commits coerentes por fatia; sem force push. Não declare deploy ou PR sem realmente executar e verificar.
constraints: sem mudanças fora do escopo, sem secrets, sem deploy, sem novas infra ou tecnologias fora das specs.
stop when: MVP completo e critérios de aceitação verificados; se faltar decisão/credencial/serviço, documente claramente o bloqueio, não invente sucesso.
```

Depois de enviar `/goal`, adicione o gate determinístico:

```text
/goal gate add cd /home/hermes/workspaces/jdrive && pnpm lint && pnpm test && pnpm build
```

Consulte progresso com `/goal status`. O loop deve ser iniciado por esta conversa Telegram/gateway, que sobrevive à desconexão.
