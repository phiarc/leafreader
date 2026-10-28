<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watchEffect } from 'vue';
import { nativeChrome, nativeChromePlatform, parseChromeAction, publishChrome, stopChromeUpdates, type ReaderChrome } from './chrome';
import Reader from './components/Reader.vue';
import { pageMarginValue, MAX_PAGE_MARGIN } from './core/reading-layout';
import { demoText, guideText } from './demo';
import { decodeText } from './core/text.mjs';
import { cloneBook, deviceId, fileHash, listBooks, removeBook, removeDownload, saveBook } from './storage';
import { cloudRequest, getToken, hasNative, nativeCall, setToken } from './bridge';
import { listCloudBooks, uploadBook, downloadBook, libraryRequest } from './library';
import { syncBooks } from './sync';
import type { Book, Conflict, Locator } from './types';
const brandLogo = `${import.meta.env.BASE_URL}branding/leaf-logo-rounded.png`;
const readerChrome = ref<ReaderChrome | null>(null); const nativePreferencesOpen = ref(false);
const books = ref<Book[]>([]); const activeId = ref(''); const readerKey = ref(0); const search = ref(''); const filter = ref('all');
const selected = computed(() => books.value.find(b => b.id === activeId.value));
const downloading = ref('');
const visibleBooks = computed(() => books.value.filter(b => !b.cloudRemoved));
const settings = ref(false); const connection = ref(false); const importing = ref(false); const busy = ref(false); const toast = ref(''); const initError = ref('');
const fileInput = ref<HTMLInputElement>(); const connectionError = ref(''); const bookmarkView = ref(false); const confirmDelete = ref<Book>();
const endpoint = ref(localStorage.getItem('leaf-endpoint') || ''); const connectionEndpoint = ref(endpoint.value); const connectionToken = ref('');
const macSession = !!window.webkit?.messageHandlers.leaf;
// The shared UI ships to two native shells; each gets its own material language.
const platform = window.__leafNativePlatform === 'windows' ? 'windows' : nativeChrome ? nativeChromePlatform : macSession ? 'macos' : hasNative() ? 'harmony' : 'web';
const connected = ref(false); const syncState = ref('尚未连接'); const syncError = ref(''); const lastSync = ref(localStorage.getItem('leaf-last-sync') || ''); const conflicts = ref<Conflict[]>([]);
const theme = ref(localStorage.getItem('leaf-theme') || 'paper'); const fontSize = ref(Number(localStorage.getItem('leaf-font')) || 20); const animation = ref(localStorage.getItem('leaf-animation') || 'slide'); const pageMargin = ref(pageMarginValue(localStorage.getItem('leaf-margin')));
const sorted = computed(() => visibleBooks.value.filter(b => (!search.value || b.title.toLowerCase().includes(search.value.toLowerCase())) && (filter.value === 'all' || filter.value === b.format)).sort((a, b) => (b.openedAt || b.importedAt).localeCompare(a.openedAt || a.importedAt)));
const recent = computed(() => [...visibleBooks.value].filter(b => b.openedAt).sort((a, b) => b.openedAt!.localeCompare(a.openedAt!))[0]);
const bookmarks = computed(() => visibleBooks.value.flatMap(book => book.bookmarks.map(mark => ({ ...mark, book }))));
const completed = computed(() => visibleBooks.value.filter(b => b.progress >= 1).length);
const todayKey = new Date().toLocaleDateString('sv-SE'); const secondsRead = ref(Number(localStorage.getItem(`leaf-read-${todayKey}`)) || 0);
const readingMinutes = computed(() => Math.floor(secondsRead.value / 60));
let toastTimer: ReturnType<typeof setTimeout>; let syncTimer: ReturnType<typeof setInterval>; let readingTimer: ReturnType<typeof setInterval>;
let saving = Promise.resolve();
function notify(message: string) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 4000); }
function persist(book: Book) {
  const snapshot = cloneBook(book);
  saving = saving.catch(() => {}).then(() => saveBook(snapshot));
  saving.catch((err: Error) => { syncError.value = `本机保存失败：${errorText(err)}`; notify('本机存储失败；当前进度尚未可靠保存'); });
  return saving;
}
function replace(book: Book) { const i = books.value.findIndex(b => b.id === book.id); if (i >= 0) books.value[i] = book; else books.value.push(book); return persist(book); }
async function open(book: Book, locator?: Locator) {
  if (downloading.value) return;
  if (book.missingFile && book.cloudAvailable) {
    if (!connected.value) { connection.value = true; return; }
    downloading.value = book.id;
    try {
      const content = await downloadBook(book, endpoint.value, value => { syncState.value = `正在下载 ${Math.round(value * 100)}%`; });
      const current = books.value.find(b => b.id === book.id);
      if (!current || current.cloudRemoved) return;
      await replace({ ...toRaw(current), content, missingFile: false });
      book = books.value.find(b => b.id === book.id)!;
      syncState.value = '已下载';
    } catch (error) { syncState.value = '下载未完成'; notify(errorText(error)); return; }
    finally { downloading.value = ''; }
  }
  if (book.missingFile) { notify('请重新导入这本书'); fileInput.value?.click(); return; }
  bookmarkView.value = false;
  if (locator) await updatePosition(book.id, locator, book.progress);
  const current = books.value.find(b => b.id === book.id)!; await replace({ ...toRaw(current), openedAt: new Date().toISOString() });
  activeId.value = book.id; readerKey.value++;
}
async function updatePosition(id: string, locator: Locator, progress: number) {
  const book = books.value.find(b => b.id === id); if (!book) return;
  if (JSON.stringify(book.locator) === JSON.stringify(locator) && book.progress === progress) return;
  await replace({ ...toRaw(book), locator, progress, dirty: true, pendingOperationId: undefined });
}
async function addBookmark(locator: Locator, label: string) {
  const book = selected.value; if (!book) return;
  if (book.bookmarks.some(b => JSON.stringify(b.locator) === JSON.stringify(locator))) { notify('这一页已经有书签了'); return; }
  await replace({ ...toRaw(book), bookmarks: [...toRaw(book).bookmarks, { id: crypto.randomUUID(), locator, label, createdAt: new Date().toISOString() }] }); notify('已添加书签');
}
async function deleteBookmark(bookId: string, id: string) { const book = books.value.find(b => b.id === bookId)!; await replace({ ...toRaw(book), bookmarks: toRaw(book).bookmarks.filter(b => b.id !== id) }); }
async function importFiles(files: FileList | File[]) {
  importing.value = true; let added = 0;
  try {
    for (const file of Array.from(files)) {
      const format = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : file.name.toLowerCase().endsWith('.txt') ? 'txt' : null;
      if (!format) { notify('目前支持 TXT 和 PDF 文件'); continue; }
      if (!file.size) { notify(`${file.name} 是空文件`); continue; }
      if (file.size > (format === 'txt' ? 30 : 100) * 1024 * 1024) { notify(`${file.name} 超出当前版本的大小限制（TXT 30 MB / PDF 100 MB）`); continue; }
      const bytes = await file.arrayBuffer(); const id = await fileHash(bytes);
      const existing = books.value.find(b => b.id === id);
      if (existing && !existing.missingFile && !existing.cloudRemoved) { notify('这本书已经在书架上，已保留原来的阅读进度'); continue; }
      if (existing) { await replace({ ...toRaw(existing), content: file, missingFile: false, cloudRemoved: false, restoreCloud: true }); notify(`已恢复《${existing.title}》，阅读进度和书签已保留`); continue; }
      let encoding: string | undefined;
      if (format === 'txt') encoding = decodeText(new Uint8Array(bytes)).encoding;
      else if (!new TextDecoder('ascii').decode(bytes.slice(0, 1024)).includes('%PDF-')) { notify(`${file.name} 不是有效的 PDF 文件`); continue; }
      const book: Book = { id, title: file.name.replace(/\.(txt|pdf)$/i, ''), fileName: file.name, format, size: file.size,
        importedAt: new Date().toISOString(), color: books.value.length % 6, encoding, locator: format === 'txt' ? { type: 'txt', offset: 0 } : { type: 'pdf', page: 0, y: 0 },
        progress: 0, revision: 0, dirty: false, content: new Blob([bytes]), bookmarks: [] };
      await saveBook(book); books.value.push(book); added++;
    }
    if (added) notify(`已将 ${added} 本书放入书架`);
  } catch (err) { notify(`导入失败：${errorText(err)}`); }
  finally { importing.value = false; if (fileInput.value) fileInput.value.value = ''; }
  if (connected.value) void sync();
}
async function seed() {
  if (localStorage.getItem('leaf-initialized')) return;
  if (!books.value.length) {
    await importFiles([new File([demoText], '山间来信.txt', { type: 'text/plain' }), new File([guideText], '让阅读慢下来.txt', { type: 'text/plain' })]);
    toast.value = '';
  }
  localStorage.setItem('leaf-initialized', '1');
}
async function syncLibrary() {
  const remote = await listCloudBooks(endpoint.value);
  const present = new Map(remote.map(book => [book.id, book]));
  for (const item of remote) {
    const local = books.value.find(book => book.id === item.id);
    if (item.state === 'deleted') {
      if (local && !local.restoreCloud && !local.cloudRemoved) {
        if (activeId.value === local.id) { activeId.value = ''; readerChrome.value = null; }
        await removeDownload(local.id);
        await replace({ ...toRaw(local), content: new Blob(), missingFile: true, cloudAvailable: false, cloudRemoved: true, dirty: false, pendingOperationId: undefined });
        conflicts.value = conflicts.value.filter(c => c.bookId !== local.id);
      }
      continue;
    }
    if (local) {
      if (!local.cloudAvailable || local.cloudRemoved || local.restoreCloud) await replace({ ...toRaw(local), cloudAvailable: true, cloudRemoved: false, restoreCloud: false });
      continue;
    }
    const response = await cloudRequest(endpoint.value, await getToken(), 'GET', `/v1/books/${item.id}/progress`);
    if (response.status !== 200 && response.status !== 404) throw new Error(response.data.error || '阅读位置获取失败');
    // Recheck because an import can finish while the remote progress request is in flight.
    if (books.value.some(book => book.id === item.id)) continue;
    await replace({ id:item.id, title:item.title, fileName:item.fileName, format:item.format, size:item.size, color:item.color,
      encoding:item.encoding, importedAt:item.importedAt, locator:response.status === 200 ? response.data.locator : item.format === 'txt' ? {type:'txt',offset:0} : {type:'pdf',page:0,y:0},
      progress:response.status === 200 ? response.data.progress : 0, revision:response.status === 200 ? response.data.revision : 0,
      content:new Blob(), missingFile:true, cloudAvailable:true, dirty:false, bookmarks:[] });
  }
  for (const book of [...books.value]) {
    if (book.localOnly || book.cloudRemoved || book.missingFile || (present.get(book.id)?.state === 'ready' && !book.restoreCloud)) continue;
    await uploadBook(book, endpoint.value, value => { syncState.value = `正在上传《${book.title}》 ${Math.round(value * 100)}%`; });
    const current = books.value.find(b => b.id === book.id);
    if (current) await replace({ ...toRaw(current), cloudAvailable:true, restoreCloud:false });
  }
}
async function sync(manual = false) {
  if (!connected.value) { if (manual) connection.value = true; return; }
  if (busy.value || downloading.value) return;
  busy.value = true; syncState.value = '正在同步…'; syncError.value = '';
  try {
    await saving;
    let fileSyncError = '';
    try { await syncLibrary(); } catch (error) { fileSyncError = errorText(error); }
    for (const book of [...books.value]) {
      if (book.dirty && !book.pendingOperationId) await replace({ ...toRaw(book), pendingOperationId: crypto.randomUUID() });
    }
    const suspended = new Set(conflicts.value.map(c => c.bookId));
    const result = await syncBooks(books.value, endpoint.value, suspended);
    for (const updated of result.updated) {
      const current = books.value.find(b => b.id === updated.id); if (!current) continue;
      const moved = JSON.stringify(current.locator) !== JSON.stringify(updated.locator);
      await replace(current.missingFile && current.cloudAvailable && !current.dirty ? { ...toRaw(current), locator:updated.locator, progress:updated.progress, revision:updated.revision, dirty:false } : moved ? { ...toRaw(current), revision: updated.revision, dirty: true, pendingOperationId: undefined } : { ...toRaw(current), revision: updated.revision, dirty: false, pendingOperationId: undefined });
    }
    conflicts.value = [...conflicts.value, ...result.conflicts];
    if (fileSyncError) throw new Error(`书籍同步未完成：${fileSyncError}`);
    if (conflicts.value.length) syncState.value = '有进度需要选择';
    else { syncState.value = '已同步'; lastSync.value = new Date().toISOString(); localStorage.setItem('leaf-last-sync', lastSync.value); if (manual) notify('书库和阅读进度已同步'); }
  } catch (err) { syncState.value = '同步未完成'; syncError.value = errorText(err); if (manual) notify(syncError.value); }
  finally { busy.value = false; }
}
async function resolveConflict(useRemote: boolean) {
  const conflict = conflicts.value.shift(); if (!conflict) return;
  const current = books.value.find(b => b.id === conflict.bookId); if (!current) return;
  await replace({ ...toRaw(current), locator: useRemote ? conflict.remote.locator : toRaw(current).locator,
    progress: useRemote ? conflict.remote.progress : current.progress, revision: conflict.remote.revision, dirty: !useRemote, pendingOperationId: undefined });
  if (activeId.value === current.id && useRemote) readerKey.value++;
  if (!conflicts.value.length) await sync(true);
}
async function connect() {
  connectionError.value = ''; busy.value = true;
  try {
    const token = connectionToken.value.trim(); if (token.length < 32) throw new Error('请输入完整的同步连接码');
    const target = connectionEndpoint.value.trim().replace(/\/$/, '');
    const result = await cloudRequest(target, token, 'GET', '/v1/health');
    if (result.status !== 200) throw new Error(result.data.error || '连接失败，请检查地址和连接码');
    await setToken(token); endpoint.value = target; localStorage.setItem('leaf-endpoint', target); connected.value = true;
    connection.value = false; connectionToken.value = ''; syncState.value = '已连接，等待同步'; notify('已连接个人同步空间');
  } catch (err) { connectionError.value = errorText(err); }
  finally { busy.value = false; }
  if (connected.value) await sync(true);
}
async function importConnection() {
  try { const value = await nativeCall<{ endpoint: string; token: string }>('importConnection'); connectionEndpoint.value = value.endpoint; connectionToken.value = value.token; await connect(); }
  catch (err) { if (errorText(err) !== '已取消导入') connectionError.value = errorText(err); }
}
async function disconnect() { await setToken(''); connected.value = false; endpoint.value = ''; localStorage.removeItem('leaf-endpoint'); syncState.value = '尚未连接'; connection.value = false; }
function saveSettings() { localStorage.setItem('leaf-theme', theme.value); localStorage.setItem('leaf-font', String(fontSize.value)); localStorage.setItem('leaf-animation', animation.value); localStorage.setItem('leaf-margin', String(pageMargin.value)); settings.value = false; }
async function deleteBook(downloadOnly = false) {
  const book = confirmDelete.value; if (!book) return;
  if (busy.value || downloading.value) { notify('请等待当前传输完成'); return; }
  try {
    await saving;
    if (downloadOnly) {
      await removeDownload(book.id);
      await replace({ ...toRaw(book), content:new Blob(), missingFile:true });
      notify('已移除下载');
    } else {
      if (book.cloudAvailable) {
        if (!connected.value) { notify('连接阅读空间后可删除这本云端书籍'); return; }
        await libraryRequest(endpoint.value,'DELETE',`/v1/books/${book.id}/file`);
      }
      await removeDownload(book.id);
      // Keep a local tombstone to stop an in-flight import/sync from resurrecting it.
      await replace({ ...toRaw(book), content:new Blob(), missingFile:true, cloudRemoved:true, cloudAvailable:false, restoreCloud:false, dirty:false });
      conflicts.value = conflicts.value.filter(c => c.bookId !== book.id);
      notify('已从书库删除');
    }
    confirmDelete.value = undefined;
  } catch (error) { notify(errorText(error)); }
}
const fmtDate = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function errorText(error: unknown): string { return error instanceof Error ? error.message || error.name : String(error || '未知错误'); }
function foreground() { if (document.visibilityState === 'visible') void sync(); }
function online() { void sync(); }
function openSettings() {
  if (nativeChrome) void nativeCall('showPreferences').catch(err => notify(errorText(err)));
  else settings.value = true;
}
function chromeAction(event: Event) {
  const message = parseChromeAction((event as CustomEvent).detail); if (!message) return;
  switch (message.action) {
    case 'library': bookmarkView.value = false; break;
    case 'bookmarks': bookmarkView.value = true; break;
    case 'settings': openSettings(); break;
    case 'connection': connection.value = true; break;
    case 'import': fileInput.value?.click(); break;
    case 'sync': void sync(true); break;
    case 'search': if (typeof message.value === 'string') search.value = message.value; break;
    case 'close': activeId.value = ''; readerChrome.value = null; void sync(); break;
    case 'preferencesVisible': nativePreferencesOpen.value = message.value === true; break;
    case 'preferences': {
      const value = message.value as Record<string, unknown> | undefined; if (!value) break;
      if (['paper', 'sepia', 'night'].includes(String(value.theme))) theme.value = String(value.theme);
      if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) fontSize.value = Math.min(32, Math.max(15, value.fontSize));
      if (typeof value.pageMargin === 'number' && Number.isFinite(value.pageMargin)) pageMargin.value = pageMarginValue(value.pageMargin);
      if (['slide', 'cover', 'flip', 'none'].includes(String(value.animation))) animation.value = String(value.animation);
      saveSettings(); break;
    }
  }
}
watchEffect(() => publishChrome({
  mode: selected.value ? 'reader' : 'library', theme: theme.value, fontSize: fontSize.value, animation: animation.value, pageMargin: pageMargin.value,
  bookCount: visibleBooks.value.length, bookmarkCount: bookmarks.value.length, bookmarkView: bookmarkView.value,
  search: search.value, syncState: syncState.value, busy: busy.value,
  blocked: settings.value || connection.value || !!conflicts.value.length || !!confirmDelete.value,
  reader: selected.value ? readerChrome.value : null
}));
async function initializeLibrary() {
  try { deviceId(); books.value = await listBooks(); await seed(); initError.value = ''; }
  catch (err) { initError.value = `无法初始化本机书架：${errorText(err)}`; }
}
onMounted(async () => {
  window.addEventListener('leaf-native-action', chromeAction);
  await initializeLibrary();
  try { connected.value = !!endpoint.value && !!(await getToken()); syncState.value = connected.value ? '等待同步' : '尚未连接'; if (connected.value) void sync(); }
  catch (err) { syncError.value = `无法恢复同步连接：${errorText(err)}`; }
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible' && !downloading.value) void sync(); }, 30000);
  readingTimer = setInterval(() => { if (activeId.value && document.visibilityState === 'visible') { secondsRead.value += 10; localStorage.setItem(`leaf-read-${todayKey}`, String(secondsRead.value)); } }, 10000);
  document.addEventListener('visibilitychange', foreground); window.addEventListener('online', online);
});
onBeforeUnmount(() => { stopChromeUpdates(); window.removeEventListener('leaf-native-action', chromeAction); clearTimeout(toastTimer); clearInterval(syncTimer); clearInterval(readingTimer); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', online); });
</script>

<template>
  <div class="app-shell" :class="theme" :data-platform="platform" :data-native-chrome="nativeChrome" :data-native-platform="nativeChromePlatform" @dragover.prevent @drop.prevent="!activeId && importFiles(Array.from($event.dataTransfer?.files || []))">
    <div class="ambient" aria-hidden="true"><i></i><i></i><i></i></div>
    <Reader v-if="selected" :key="`${selected.id}-${readerKey}`" :book="selected" :theme="theme" :font-size="fontSize" :animation="animation" :page-margin="pageMargin" :edge-tap="platform === 'harmony'" :settings-open="settings || nativePreferencesOpen" @chrome="readerChrome = $event" @close="activeId = ''; sync()" @position="(locator, progress) => updatePosition(selected!.id, locator, progress)" @bookmark="addBookmark" @settings="openSettings"/>
    <template v-else>
      <aside v-if="!nativeChrome" class="sidebar">
        <a class="brand" href="#" @click.prevent="bookmarkView = false"><img class="brand-symbol" :src="brandLogo" alt=""/><span>页间<small>LEAF READER</small></span></a>
        <div class="sidebar-caption">我的空间</div>
        <nav><button :class="{ active: !bookmarkView }" @click="bookmarkView = false"><span>▤</span>我的书架<small>{{ visibleBooks.length }}</small></button><button :class="{ active: bookmarkView }" @click="bookmarkView = true"><span>♧</span>我的书签<small>{{ bookmarks.length }}</small></button></nav>
        <div class="sidebar-note"><span class="tiny-leaf">❧</span><p>把时间，<br/>留给一页好书。</p><span>ONE MORE PAGE.</span></div>
        <div class="sidebar-bottom"><button @click="openSettings"><span>⚙</span>阅读偏好</button><button class="sync-account" @click="connection = true"><span class="avatar">{{ connected ? '云' : '页' }}</span><span><strong>{{ connected ? '个人同步空间' : '阅读空间' }}</strong><small><i :class="{ online: connected }"></i>{{ syncState }}</small></span><span>↗</span></button></div>
      </aside>
      <main class="library">
        <header class="topbar"><div class="breadcrumb">我的空间 <span>/</span> <strong>{{ bookmarkView ? '我的书签' : '我的书架' }}</strong></div><button class="sync-button" :class="{spinning: busy}" @click="sync(true)"><span>↻</span>{{ busy ? '同步中' : '同步书库' }}</button></header>
        <div v-if="initError" class="error-banner" role="alert">{{ initError }} <button @click="initializeLibrary">重试加载书架</button></div><div v-if="syncError" class="error-banner" role="status">同步未完成：{{ syncError }}</div>
        <template v-if="!bookmarkView">
          <section class="library-heading"><div><div class="eyebrow">A LITTLE QUIET, A LITTLE READING.</div><h1>在书页间，慢下来<span>。</span></h1><p>世界很大，先读完这一页。</p></div><button class="primary" :disabled="importing" @click="fileInput?.click()"><span>＋</span>{{ importing ? '正在导入…' : '导入书籍' }}</button></section>
          <section class="welcome-card" :class="{ 'continue-card': recent }">
            <div><div class="eyebrow">{{ recent ? 'CONTINUE READING / 继续阅读' : 'YOUR NEXT CHAPTER / 从这里开始' }}</div><h2>{{ recent?.title || '一本书，一段只属于你的时间。' }}</h2><p>{{ recent ? `已读 ${Math.round(recent.progress * 100)}% · 上次打开 ${fmtDate(recent.openedAt!)}` : '导入喜欢的书，随时翻开；每一次停留，都会为你记住。' }}</p><button class="text-link" @click="recent ? open(recent) : sorted[0] ? open(sorted[0]) : fileInput?.click()">{{ recent ? '接着读' : '翻开第一本书' }}<span>↗</span></button></div>
            <div class="book-art" aria-hidden="true"><div class="art-book back"></div><div class="art-book front"><div class="art-lines"></div><span>慢<br/>读</span><small>READ AT YOUR OWN PACE</small></div><div class="art-sprig">⌁</div></div>
          </section>
          <section class="shelf-section"><div class="shelf-toolbar"><div class="shelf-title"><h2>我的书架</h2><span>{{ visibleBooks.length }} 本藏书</span></div><label class="search-field"><span>⌕</span><input v-model="search" placeholder="寻找一本书…" aria-label="搜索书架"/><kbd>⌕</kbd></label></div>
            <div class="filter-row"><div class="filter-tabs"><button v-for="tab in [{ id: 'all', label: '全部书籍' }, { id: 'txt', label: 'TXT' }, { id: 'pdf', label: 'PDF' }]" :key="tab.id" :class="{selected: filter === tab.id}" @click="filter = tab.id">{{ tab.label }}</button></div><span class="muted sort-label">最近阅读 ↓</span></div>
            <div v-if="sorted.length" class="book-grid">
              <article v-for="book in sorted" :key="book.id" class="book-card">
                <button class="book-cover" :class="`cover-${book.color}`" :aria-label="`阅读 ${book.title}`" @click="open(book)"><span class="cover-format">{{ book.format.toUpperCase() }}</span><span class="cover-rule"></span><strong>{{ book.title }}</strong><span class="cover-caption">{{ book.format === 'pdf' ? 'PAGES OF POSSIBILITY' : 'A WORLD BETWEEN PAGES' }}</span><span class="cover-decoration" aria-hidden="true">{{ ['◯','⌁','◇','◒','⊹','∿'][book.color] }}</span><span class="cover-imprint">页 间 藏 书</span></button>
                <div class="book-meta"><button class="book-name" @click="open(book)">{{ book.title }}</button><button class="book-menu" :aria-label="`移除 ${book.title}`" @click="confirmDelete = book">×</button></div><div class="book-details"><span>{{ downloading === book.id ? syncState : book.missingFile && book.cloudAvailable ? '云端书籍 · 点击下载' : book.missingFile ? '点击重新导入' : book.openedAt ? `已读 ${Math.round(book.progress * 100)}%` : '还未翻开' }}</span><span>{{ book.format.toUpperCase() }}<span class="dot">·</span>{{ book.size < 1024 * 1024 ? `${Math.max(1, Math.round(book.size / 1024))} KB` : `${(book.size / 1024 / 1024).toFixed(1)} MB` }}</span></div><div class="book-progress"><span :style="{width: `${book.progress * 100}%`}"></span></div>
              </article>
              <button v-if="!search" class="import-card" @click="fileInput?.click()"><span>＋</span><strong>下一本好书</strong><small>点击导入，或将文件拖到这里</small><em>TXT / PDF</em></button>
            </div>
            <div v-else class="empty-state"><span>▤</span><h3>{{ search ? '还没有找到这本书' : '书架正等着第一本书' }}</h3><p>{{ search ? '换一个关键词试试。' : '支持 TXT 和 PDF，导入即可开始。' }}</p><button v-if="!search" class="primary" @click="fileInput?.click()">导入书籍</button></div>
          </section>
          <footer class="library-footer"><span><i class="status-dot"></i>{{ connected ? '书库与阅读进度同步' : '在书页间，慢下来' }}</span><span>今天阅读 {{ readingMinutes }} 分钟<span class="footer-separator">/</span>已读完 {{ completed }} 本</span></footer>
        </template>
        <section v-else class="bookmark-library"><div class="eyebrow">KEEP A PAGE, KEEP A THOUGHT.</div><h1>留住这一页。</h1><p class="muted">记录那些想要再读一遍的地方。</p><div v-if="!bookmarks.length" class="empty-state"><span>♧</span><h3>喜欢的书页，值得再见</h3><p>阅读时点击书签按钮，在这里找到它。</p></div><article v-for="mark in bookmarks" :key="mark.id" class="bookmark-row"><div><small>{{ mark.book.title }}</small><button @click="open(mark.book, mark.locator)">{{ mark.label }}</button></div><button class="icon-button" aria-label="删除书签" @click="deleteBookmark(mark.book.id, mark.id)">×</button></article></section>
      </main>
    </template>
    <input ref="fileInput" class="hidden-input" type="file" accept=".txt,.pdf,text/plain,application/pdf" multiple aria-label="选择电子书" @change="importFiles(($event.target as HTMLInputElement).files || [])"/>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <div v-if="settings" class="modal-backdrop" @click.self="saveSettings"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="panel-heading"><h2 id="settings-title">让阅读更合心意</h2><button class="icon-button" aria-label="关闭设置" @click="saveSettings">×</button></div><p class="muted">找到最舒服的书页。</p><label class="setting-label">书页主题</label><div class="theme-options"><button v-for="item in [{ id: 'paper', label: '纸白' }, { id: 'sepia', label: '暖纸' }, { id: 'night', label: '夜色' }]" :key="item.id" :class="[item.id, {selected: theme === item.id}]" @click="theme = item.id"><span>Aa</span>{{ item.label }}</button></div><label class="setting-label" for="font-size">正文字号 <span>{{ fontSize }} px</span></label><input id="font-size" v-model.number="fontSize" type="range" min="15" max="32"/><label class="setting-label" for="page-margin">左右留白（每侧） <span>{{ pageMargin }}%</span></label><input id="page-margin" v-model.number="pageMargin" type="range" min="0" :max="MAX_PAGE_MARGIN" step="0.1"/><label class="setting-label" for="animation">翻页方式</label><select id="animation" v-model="animation"><option value="slide">轻盈滑动</option><option value="cover">覆盖翻页</option><option value="flip">书页翻转</option><option value="none">直接翻页</option></select><p class="fine-print">字号只影响 TXT；PDF 可在阅读页选择缩放。</p><button class="primary full-width" @click="saveSettings">完成</button></section></div>
    <div v-if="connection" class="modal-backdrop" @click.self="connection = false"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="connection-title"><div class="panel-heading"><h2 id="connection-title">在另一端，接着读</h2><button class="icon-button" aria-label="关闭同步设置" @click="connection = false">×</button></div><p class="muted">连接个人同步空间，同步书架和每一次阅读的位置。</p><button v-if="macSession || platform === 'windows'" class="choice-button" @click="importConnection"><strong>导入同步配置</strong><span>选择个人配置文件 →</span></button><form @submit.prevent="connect"><label class="setting-label" for="endpoint">同步空间地址</label><input id="endpoint" v-model="connectionEndpoint" type="url" placeholder="https://…azurewebsites.net/api" required autocomplete="off"/><label class="setting-label" for="token">个人空间连接码</label><input id="token" v-model="connectionToken" type="password" placeholder="输入部署时生成的连接码" required autocomplete="off"/><p v-if="connectionError" class="error" role="alert">{{ connectionError }}</p><button class="primary full-width" :disabled="busy">{{ busy ? '正在连接…' : '连接同步空间' }}</button></form><div v-if="connected" class="connection-info"><span>{{ lastSync ? `上次同步 ${fmtDate(lastSync)}` : syncState }}</span><button class="text-link" @click="disconnect">断开连接</button></div></section></div>
    <div v-if="conflicts.length" class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><h2 id="conflict-title">从哪里继续读？</h2><p>{{ books.find(b => b.id === conflicts[0].bookId)?.title }} 在另一台设备上有不同的进度。</p><button class="choice-button" @click="resolveConflict(false)"><strong>保留这台设备的位置</strong><span>已读 {{ Math.round((books.find(b => b.id === conflicts[0].bookId)?.progress || 0) * 100) }}%</span></button><button class="choice-button" @click="resolveConflict(true)"><strong>使用云端的位置</strong><span>已读 {{ Math.round(conflicts[0].remote.progress * 100) }}%</span></button><p class="fine-print">选择后会同步所选位置。</p></section></div>
    <div v-if="confirmDelete" class="modal-backdrop" @click.self="confirmDelete = undefined"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">管理这本书</h2><p>《{{ confirmDelete.title }}》</p><div class="modal-actions"><button @click="confirmDelete = undefined">取消</button><button v-if="confirmDelete.cloudAvailable && !confirmDelete.missingFile" :disabled="busy || !!downloading" @click="deleteBook(true)">移除下载</button><button class="danger" :disabled="busy || !!downloading" @click="deleteBook(false)">从书库删除</button></div></section></div>
  </div>
</template>
