<svelte:head><title>JDrive — arquivos privados</title></svelte:head>
<main>
  <div class="topline"><span class="brand-mark">J</span><span>JDRIVE</span><span class="status">ESPAÇO PESSOAL</span></div>
  <section class="hero"><p class="eyebrow">SEUS ARQUIVOS, NO SEU ESPAÇO</p><h1>Um lugar simples<br />para <em>seus arquivos.</em></h1><p class="intro">Privado por natureza. Acesse de qualquer dispositivo.</p></section>
  <section class="login" aria-labelledby="login-title"><div class="login-icon">↗</div><h2 id="login-title">Entre no seu espaço</h2><p>Acesse seus arquivos com segurança.</p><form onsubmit={(event) => event.preventDefault()}><label for="username">USUÁRIO</label><input id="username" name="username" autocomplete="username" placeholder="Seu usuário" /><label for="password">SENHA</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" /><button type="submit">Entrar <span>→</span></button></form><div class="secure"><span>●</span> CONEXÃO PRIVADA E PROTEGIDA</div></section>
  <footer><span>JDRIVE / ARQUIVOS PESSOAIS</span><span>SEU ESPAÇO. SUAS REGRAS.</span></footer>
</main>
