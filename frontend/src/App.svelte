<script lang="ts">
  import { onMount } from 'svelte';
  import { createLatestRequest, fileSearchURL, formatBytes, uploadProgress } from './file-utils.js';
  import { shouldApplyRefreshError } from './refresh-state.js';

  type User = { id: string; username: string };
  type StoredFile = { id: string; originalName: string; sizeBytes: number; mimeType: string | null; createdAt: string };
  type Storage = { usedBytes: number; maxBytes: number; percentage: number };
  type UploadState = 'queued' | 'uploading' | 'completed' | 'failed';
  type UploadItem = { key: string; file: File; state: UploadState; progress: number; error?: string };

  let user: User | null = $state(null);
  let checking = $state(true);
  let username = $state('');
  let password = $state('');
  let loginError = $state('');
  let refreshError = $state('');
  let busy = $state(false);
  let search = $state('');
  let storedFiles: StoredFile[] = $state([]);
  let totalFiles = $state(0);
  let fileOffset = $state(0);
  let hasMoreFiles = $state(false);
  let loadingMore = $state(false);
  let loadingMoreRequestId: number | null = null;
  const pageSize = 50;
  let storage: Storage = $state({ usedBytes: 0, maxBytes: 10 * 1024 ** 3, percentage: 0 });
  let uploads: UploadItem[] = $state([]);
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let searchTimer: ReturnType<typeof setTimeout>;
  const searchRequests = createLatestRequest();

  const api = '/api';
  const formatDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${api}${url}`, { credentials: 'same-origin', ...init });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message ?? 'Não foi possível concluir a solicitação.');
    }
    return (response.status === 204 ? undefined : response.json()) as Promise<T>;
  }

  function syncRoute(isLoggedIn: boolean) {
    if (typeof window === 'undefined') return;
    const target = isLoggedIn ? (window.location.pathname === '/login' ? '/' : window.location.pathname) : '/login';
    if (target !== window.location.pathname) window.history.replaceState({}, '', target);
  }

  async function refreshFiles(query = search, append = false, requestId = searchRequests.begin()) {
    const offset = append ? fileOffset : 0;
    const url = fileSearchURL(query);
    const result = await request<{ files: StoredFile[]; total: number }>(`${url}${url.includes('?') ? '&' : '?'}limit=${pageSize}&offset=${offset}`);
    if (!searchRequests.isCurrent(requestId)) return;
    storedFiles = append ? [...storedFiles, ...result.files] : result.files;
    totalFiles = result.total;
    fileOffset = offset + result.files.length;
    hasMoreFiles = fileOffset < result.total;
  }
  async function loadMoreFiles() {
    if (loadingMore || !hasMoreFiles) return;
    const requestId = searchRequests.begin();
    loadingMoreRequestId = requestId;
    loadingMore = true;
    try { await refreshFiles(search, true, requestId); }
    catch { if (searchRequests.isCurrent(requestId)) refreshError = 'Não foi possível carregar mais arquivos. Tente novamente.'; }
    finally {
      if (loadingMoreRequestId === requestId) {
        loadingMore = false;
        loadingMoreRequestId = null;
      }
    }
  }
  async function refreshStorage() { storage = await request<Storage>('/storage'); }
  async function refreshData() {
    const requestId = searchRequests.current();
    const query = search;
    const results = await Promise.allSettled([refreshFiles(query, false, requestId), refreshStorage()]);
    const failed = results.some((result) => result.status === 'rejected');
    if (shouldApplyRefreshError(searchRequests, requestId)) refreshError = failed ? 'Não foi possível atualizar alguns dados. Tente novamente.' : '';
  }

  onMount(() => {
    const normalizeLocation = () => syncRoute(Boolean(user));
    window.addEventListener('popstate', normalizeLocation);
    void checkSession();
    return () => window.removeEventListener('popstate', normalizeLocation);
  });

  async function checkSession() {
    try {
      const result = await request<{ user: User }>('/auth/me');
      user = result.user;
      await refreshData();
    } catch { user = null; }
    finally { syncRoute(Boolean(user)); checking = false; }
  }

  async function login(event: SubmitEvent) {
    event.preventDefault();
    loginError = '';
    busy = true;
    try {
      const result = await request<{ user: User }>('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      user = result.user;
      syncRoute(true);
      password = '';
      await refreshData();
    } catch (error) { loginError = error instanceof Error ? error.message : 'Falha ao entrar.'; }
    finally { busy = false; }
  }

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
      user = null;
      storedFiles = [];
      uploads = [];
      syncRoute(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.');
    }
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    const requestId = searchRequests.begin();
    fileOffset = 0;
    totalFiles = 0;
    hasMoreFiles = false;
    loadingMore = false;
    loadingMoreRequestId = null;
    searchTimer = setTimeout(() => {
      void refreshFiles(search, false, requestId).catch(() => {
        if (searchRequests.isCurrent(requestId)) refreshError = 'Não foi possível atualizar a busca. Tente novamente.';
      });
    }, 250);
  }

  function addFiles(list: FileList | File[]) {
    const selected = Array.from(list);
    uploads = [...uploads, ...selected.map((file) => ({ key: crypto.randomUUID(), file, state: 'queued' as const, progress: 0 }))];
    void processQueue();
  }

  let queueRunning = false;
  async function processQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      const workers = Array.from({ length: 2 }, async () => {
        while (true) {
          const next = uploads.find((item) => item.state === 'queued');
          if (!next) return;
          uploads = uploads.map((item) => item.key === next.key ? { ...item, state: 'uploading', progress: 0 } : item);
          try {
            await uploadFile(next);
            uploads = uploads.map((item) => item.key === next.key ? { ...item, state: 'completed', progress: 100 } : item);
          } catch (error) {
            uploads = uploads.map((item) => item.key === next.key ? { ...item, state: 'failed', error: error instanceof Error ? error.message : 'Falha no envio.' } : item);
          }
        }
      });
      await Promise.all(workers);
    } finally {
      queueRunning = false;
      await refreshData();
      if (uploads.some((item) => item.state === 'queued')) void processQueue();
    }
  }

  function uploadFile(item: UploadItem): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = new FormData();
      data.append('file', item.file, item.file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${api}/files`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const progress = uploadProgress(event.loaded, event.total);
        uploads = uploads.map((upload) => upload.key === item.key ? { ...upload, progress } : upload);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          let message = 'Falha ao enviar arquivo.';
          try { message = JSON.parse(xhr.responseText).error?.message ?? message; } catch { /* Ignore invalid error payload. */ }
          reject(new Error(message));
        }
      };
      xhr.onerror = () => reject(new Error('Falha de conexão durante o envio.'));
      xhr.onabort = () => reject(new Error('Envio cancelado.'));
      xhr.send(data);
    });
  }

  async function removeFile(file: StoredFile) {
    if (!confirm(`Excluir “${file.originalName}”? Esta ação remove o arquivo permanentemente.`)) return;
    try {
      await request(`/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      await refreshData();
    } catch (error) { alert(error instanceof Error ? error.message : 'Falha ao excluir.'); }
  }

  function dropFiles(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
  }
</script>

<svelte:head><title>JDrive — seus arquivos privados</title><meta name="description" content="Acesse seus arquivos pessoais com segurança." /></svelte:head>

{#if checking}
  <main class="checking"><span class="brand-mark">J</span><p>Conectando ao seu espaço…</p></main>
{:else if !user}
  <main class="login-shell">
    <div class="topline"><a class="brand" href="/" aria-label="JDrive"><span class="brand-mark">J</span><span>JDRIVE</span></a></div>
    <section class="login-card" aria-labelledby="login-title"><h2 id="login-title">Entre no seu espaço</h2>
      <form onsubmit={login}>
        <label for="username">USUÁRIO</label><input id="username" bind:value={username} autocomplete="username" required placeholder="Seu usuário" />
        <label for="password">SENHA</label><input id="password" bind:value={password} type="password" autocomplete="current-password" required placeholder="Sua senha" />
        {#if loginError}<div class="form-error" role="alert">{loginError}</div>{/if}
        <button type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'} <span>→</span></button>
      </form>
    </section>
  </main>
{:else}
  <main class="app-shell">
    <header class="app-header"><a class="brand" href="/" aria-label="JDrive"><span class="brand-mark">J</span><span>JDRIVE</span></a><div class="user-menu"><span class="avatar">{user.username.slice(0, 1).toUpperCase()}</span><span class="user-name">{user.username}</span><button class="text-button" onclick={logout}>Sair</button></div></header>
    <section class="storage-card" aria-label="Uso do armazenamento"><div class="storage-top"><div><span class="eyebrow">ARMAZENAMENTO</span><p><strong>{formatBytes(storage.usedBytes)}</strong> <span class="muted">de {formatBytes(storage.maxBytes)}</span></p></div><span class="storage-percent">{storage.percentage.toFixed(1)}%</span></div><div class="progress-track"><div class="progress-fill" style={`width:${Math.min(100, storage.percentage)}%`}></div></div></section>
    {#if refreshError}<p class="error-text" role="status" aria-live="polite">{refreshError}</p>{/if}
    <section class:dragging class="dropzone" aria-label="Área para enviar arquivos" ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => dragging = false} ondrop={dropFiles}>
      <input bind:this={fileInput} class="visually-hidden" id="file-picker" aria-label="Selecionar arquivos para envio" type="file" multiple onchange={(event) => { const input = event.currentTarget as HTMLInputElement; if (input.files) addFiles(input.files); input.value = ''; }} />
      <div class="upload-icon">↑</div><div><h2>Solte arquivos aqui</h2><p>ou escolha do seu dispositivo para começar a enviar.</p></div><button class="secondary-button" onclick={() => fileInput?.click()}>Selecionar arquivos</button>
    </section>
    {#if uploads.length}
      <section class="upload-section"><div class="section-heading"><h2>Envios</h2><button class="text-button" onclick={() => uploads = uploads.filter((item) => item.state === 'queued' || item.state === 'uploading')}>Limpar concluídos</button></div>
        <div class="upload-list">{#each uploads as item (item.key)}<article class="upload-row"><span class="file-glyph">↗</span><div class="upload-info"><div class="upload-title"><strong>{item.file.name}</strong><span class:state-done={item.state === 'completed'} class:state-failed={item.state === 'failed'} class="upload-state" role="status" aria-live="polite">{item.state === 'queued' ? 'Na fila' : item.state === 'uploading' ? 'Enviando' : item.state === 'completed' ? 'Concluído' : 'Falhou'}</span></div><div class="upload-subtitle">{formatBytes(item.file.size)}{#if item.error}<span class="error-text"> · {item.error}</span>{/if}</div>{#if item.state === 'uploading' || item.state === 'queued'}<div class="progress-track thin" role="progressbar" aria-label={`Progresso de ${item.file.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={item.progress}><div class="progress-fill" style={`width:${item.progress}%`}></div></div>{/if}</div><span class="upload-percent">{item.progress}%</span></article>{/each}</div>
      </section>
    {/if}
    <section class="files-section"><div class="section-heading"><div><p class="eyebrow">SUA BIBLIOTECA</p><h2>Arquivos <span class="count">{totalFiles}</span></h2></div><label class="search-box"><span>⌕</span><input aria-label="Buscar arquivos" bind:value={search} oninput={onSearchInput} placeholder="Buscar pelo nome…" /></label></div>
      {#if storedFiles.length}
        <div class="file-list">{#each storedFiles as file (file.id)}<article class="file-row"><div class="file-glyph">↗</div><div class="file-main"><strong>{file.originalName}</strong><span>{formatBytes(file.sizeBytes)}{#if file.mimeType}<i>·</i> {file.mimeType}{/if} <i>·</i> {formatDate(file.createdAt)}</span></div><div class="file-actions"><a class="icon-button" href={`${api}/files/${encodeURIComponent(file.id)}/download`} aria-label={`Baixar ${file.originalName}`} title="Baixar">↓</a><button class="icon-button delete-button" aria-label={`Excluir ${file.originalName}`} title="Excluir" onclick={() => removeFile(file)}>×</button></div></article>{/each}</div>
      {:else}<div class="empty-state"><div class="empty-icon">⌁</div><h3>{search ? 'Nenhum arquivo encontrado' : 'Seu espaço está pronto'}</h3><p>{search ? 'Tente buscar por outro nome.' : 'Envie seu primeiro arquivo para acessá-lo de qualquer dispositivo.'}</p></div>{/if}
      {#if hasMoreFiles}<div class="load-more"><button class="secondary-button" disabled={loadingMore} aria-busy={loadingMore} onclick={loadMoreFiles}>{loadingMore ? 'Carregando…' : 'Carregar mais arquivos'}</button></div>{/if}
    </section>
  </main>
{/if}
