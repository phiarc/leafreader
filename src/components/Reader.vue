<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { nativeChrome, parseChromeAction, type ReaderChrome } from '../chrome';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { clampOffset, CodePointText, readingText, decodeText, findChapters } from '../core/text.mjs';
import { pageMarginValue } from '../core/reading-layout';
import { pageEnd, previousPageStart } from '../core/pagination.mjs';
import { tapZone } from '../core/tap-zone.mjs';
import { TrackpadView } from '../core/trackpad-view';
import { TrackpadPager } from '../core/trackpad.mjs';
import { restartTurnAnimation } from '../core/turn-animation';
import type { Book, Chapter, Locator } from '../types';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const props = defineProps<{ book: Book; theme: string; fontSize: number; animation: string; pageMargin?: number; edgeTap?: boolean; settingsOpen?: boolean }>();
const emit = defineEmits<{ close: []; position: [locator: Locator, progress: number]; bookmark: [locator: Locator, label: string]; settings: []; chrome: [state: ReaderChrome] }>();
const readingBody = ref<HTMLElement>(); const page = ref<HTMLElement>(); const measure = ref<HTMLElement>(); const canvas = ref<HTMLCanvasElement>();
const text = ref(''); const loading = ref(true); const error = ref('');
const start = ref(0); const end = ref(0); const pdfPage = ref(1); const pdfPages = ref(0);
const chapters = ref<Chapter[]>([]); const showContents = ref(false); const showSearch = ref(false); const query = ref(''); const searchInfo = ref('');
const encoding = ref(props.book.encoding || 'auto'); const direction = ref('forward'); const animating = ref(false);
const zoom = ref(1); let documentText = new CodePointText(''); const textLength = ref(0); let preparingTurn = false; let pdf: pdfjs.PDFDocumentProxy | undefined; let pdfLoading: pdfjs.PDFDocumentLoadingTask | undefined; let renderTask: pdfjs.RenderTask | undefined;
let resize: ResizeObserver | undefined; let resizeTimer: ReturnType<typeof setTimeout>; let marginTimer: ReturnType<typeof setTimeout>; let turnTimer: ReturnType<typeof setTimeout>; let destroyed = false; let renderVersion = 0;
let ghost: HTMLElement | null = null;
const controlsVisible = ref(true); const showReadingHint = ref(true);
let controlsTimer: ReturnType<typeof setTimeout>; let nativeInteracting = false;
const trackpad = new TrackpadPager();
const previousPages = new Map<number, number>();
const macTrackpad = !!window.__leafTrackpadPhases || !!window.webkit?.messageHandlers.leaf || /Mac/.test(navigator.platform);
function scheduleControlsHide() {
  clearTimeout(controlsTimer);
  if (nativeInteracting || !controlsVisible.value || showContents.value || showSearch.value || props.settingsOpen || loading.value || error.value) return;
  controlsTimer = setTimeout(() => {
    if (document.activeElement?.matches(':focus-visible') && document.activeElement.closest('.reader-toolbar, .reader-footer')) { scheduleControlsHide(); return; }
    controlsVisible.value = false; showReadingHint.value = false;
  }, 3500);
}
function toggleControls() {
  const visible = !controlsVisible.value;
  if (!visible) { showContents.value = false; showSearch.value = false; }
  controlsVisible.value = visible; showReadingHint.value = false; scheduleControlsHide();
}
function hideForReading() {
  if (showContents.value || showSearch.value || props.settingsOpen) return;
  controlsVisible.value = false; showReadingHint.value = false; clearTimeout(controlsTimer);
}
type SwipeTarget = { type: 'txt'; start: number; end: number; text: string } | { type: 'pdf'; page: number; bitmap: HTMLCanvasElement };
interface SwipeSession {
  sequence: number; back: boolean; distance: number; view: TrackpadView | null;
  target: SwipeTarget | null; edge: boolean; commitRequested: boolean; fastForward: boolean; cancelled: boolean; finishing: boolean;
  completion: Promise<void>; resolve: () => void;
}
let swipe: SwipeSession | null = null;
let swipeWidth = 740; let swipeIdle: ReturnType<typeof setTimeout>; let pdfWarmTimer: ReturnType<typeof setTimeout>;
const pdfPreviews = new Map<string, Promise<HTMLCanvasElement>>();
const previewTasks = new Set<pdfjs.RenderTask>(); let previewGeneration = 0;
function cancelSwipeSession(session: SwipeSession) {
  session.cancelled = true; session.view?.dispose(); session.resolve();
  if (swipe === session) swipe = null;
}
function cancelTrackpad() { clearTimeout(swipeIdle); trackpad.reset(); if (swipe) cancelSwipeSession(swipe); }
function clearPdfPreviews() {
  previewGeneration++; clearTimeout(pdfWarmTimer); for (const task of previewTasks) task.cancel(); previewTasks.clear(); pdfPreviews.clear();
}
async function pdfPreview(number: number): Promise<HTMLCanvasElement> {
  if (!pdf || !page.value) throw new Error('PDF 尚未加载');
  const bounds = page.value.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
  const key = `${number}:${bounds.width}:${bounds.height}:${zoom.value}:${ratio}`;
  const cached = pdfPreviews.get(key);
  if (cached) { pdfPreviews.delete(key); pdfPreviews.set(key, cached); return cached; }
  const document = pdf; const generation = previewGeneration;
  const job = (async () => {
    const sheet = await document.getPage(number);
    if (destroyed || generation !== previewGeneration) throw new Error('Preview cancelled');
    const initial = sheet.getViewport({scale: 1});
    const scale = Math.min((bounds.width - 32) / initial.width, (bounds.height - 20) / initial.height) * zoom.value;
    const viewport = sheet.getViewport({scale}); const target = window.document.createElement('canvas');
    target.width = Math.floor(viewport.width * ratio); target.height = Math.floor(viewport.height * ratio);
    target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
    const task = sheet.render({canvas: target, viewport, transform: [ratio,0,0,ratio,0,0]}); previewTasks.add(task);
    try { await task.promise; return target; } finally { previewTasks.delete(task); }
  })();
  pdfPreviews.set(key, job);
  while (pdfPreviews.size > 2) pdfPreviews.delete(pdfPreviews.keys().next().value!);
  void job.catch(() => { if (pdfPreviews.get(key) === job) pdfPreviews.delete(key); });
  return job;
}
function warmPdfNext() {
  clearTimeout(pdfWarmTimer);
  if (!macTrackpad || !pdf || pdfPage.value >= pdfPages.value || destroyed) return;
  const number = pdfPage.value + 1;
  pdfWarmTimer = setTimeout(() => { if (!destroyed) void pdfPreview(number).catch(() => {}); }, 60);
}
function canSwipe(back: boolean) {
  return props.book.format === 'pdf' ? (back ? pdfPage.value > 1 : pdfPage.value < pdfPages.value) : (back ? start.value > 0 : end.value < textLength.value);
}
function finishSwipe(session: SwipeSession, commit: boolean) {
  if (session.cancelled || session.finishing) return;
  session.commitRequested = commit;
  if (commit && !session.edge && !session.target) return; // Adjacent PDF may still be rendering.
  if (!session.view) { cancelSwipeSession(session); return; }
  session.finishing = true;
  void (async () => {
    try {
      const motion = session.view!.settle(commit && !session.edge);
      if (session.fastForward) session.view!.finishNow();
      const completed = await motion;
      if (completed && !session.cancelled && !destroyed && commit && session.target) {
        const target = session.target;
        if (target.type === 'txt') {
          start.value = target.start; end.value = target.end; text.value = target.text;
          previousPages.set(target.end, target.start);
        } else if (canvas.value) {
          pdfPage.value = target.page;
          const bitmap = canvas.value; bitmap.width = target.bitmap.width; bitmap.height = target.bitmap.height;
          bitmap.style.width = target.bitmap.style.width; bitmap.style.height = target.bitmap.style.height;
          bitmap.getContext('2d')?.drawImage(target.bitmap, 0, 0);
          warmPdfNext();
        }
        report(); await nextTick();
      }
    } finally {
      session.view?.dispose(); session.resolve(); if (swipe === session) swipe = null;
    }
  })();
}
function createSwipe(back: boolean, sequence: number): SwipeSession {
  const previous = swipe;
  if (previous && !previous.commitRequested) cancelSwipeSession(previous);
  else if (previous) { previous.fastForward = true; previous.view?.finishNow(); }
  let resolve: () => void = () => {};
  const completion = new Promise<void>(done => { resolve = done; });
  const session: SwipeSession = { sequence, back, distance: 0, view: null, target: null, edge: false,
    commitRequested: false, fastForward: false, cancelled: false, finishing: false, completion, resolve };
  swipe = session;
  void (async () => {
    try {
      if (previous?.commitRequested) await previous.completion;
      clearGhost(); await nextTick();
      if (session.cancelled || destroyed || (swipe !== session && !session.commitRequested) || !page.value) { cancelSwipeSession(session); return; }
      const surface = props.book.format === 'txt' ? page.value.querySelector<HTMLElement>('.page-content') : canvas.value;
      if (!surface) { cancelSwipeSession(session); return; }
      session.edge = !canSwipe(back);
      session.view = new TrackpadView(page.value, surface, back, page.value.clientWidth, props.animation !== 'none' && !reduceMotion(), session.edge);
      session.view.update(session.distance);
      if (session.edge) { if (session.commitRequested) finishSwipe(session, false); return; }
      if (props.book.format === 'txt') {
        const boundary = start.value;
        const begin = back ? previousPages.get(boundary) ?? previousPageStart(boundary, textLength.value, chapters.value, fits) : end.value;
        const finish = pageEnd(begin, textLength.value, chapters.value, fits, back ? boundary : textLength.value);
        session.target = {type:'txt',start:begin,end:finish,text:readingText(documentText.slice(begin,finish))};
        const node = document.createElement('div'); node.className = 'page-text'; node.textContent = session.target.text;
        session.view.setContent(node);
      } else {
        const number = pdfPage.value + (back ? -1 : 1); const bitmap = await pdfPreview(number);
        if (session.cancelled || session.finishing || destroyed) return;
        session.target = {type:'pdf',page:number,bitmap}; session.view.setContent(bitmap);
      }
      if (session.commitRequested) finishSwipe(session, true);
    } catch (err) {
      if (!session.cancelled && !destroyed) { finishSwipe(session, false); error.value = `无法准备下一页：${(err as Error).message}`; }
    }
  })();
  return session;
}
function wheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) { cancelTrackpad(); return; }
  if (!macTrackpad || showContents.value || showSearch.value || props.settingsOpen || loading.value || error.value) return;
  if (preparingTurn) { if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault(); return; }
  if (!trackpad.active && !trackpad.committed) swipeWidth = page.value?.clientWidth || 740;
  const gesture = trackpad.handle(event, performance.now(), swipeWidth);
  if (!gesture.consume) return;
  event.preventDefault(); hideForReading();
  if (!trackpad.active && trackpad.ended) return;
  if (trackpad.committed && !gesture.turn && (!swipe || swipe.sequence !== gesture.sequence)) return;
  const back = gesture.distance < 0;
  let session = swipe;
  if (!session || session.sequence !== gesture.sequence || (!session.commitRequested && gesture.distance !== 0 && session.back !== back)) session = createSwipe(back, gesture.sequence);
  session.distance = gesture.distance;
  if (!session.finishing) session.view?.update(gesture.distance);
  if (gesture.turn) finishSwipe(session, true);
  clearTimeout(swipeIdle);
  if (!trackpad.explicit) swipeIdle = setTimeout(() => { const result = trackpad.end(); if (swipe?.sequence === gesture.sequence) finishSwipe(swipe, result.commit); }, 90);
}
function trackpadPhase(event: Event) {
  const phase = (event as CustomEvent).detail;
  if (phase === 'begin') {
    clearTimeout(swipeIdle);
    if (swipe && !swipe.commitRequested) cancelSwipeSession(swipe); else if (swipe) { swipe.fastForward = true; swipe.view?.finishNow(); }
    swipeWidth = page.value?.clientWidth || 740; trackpad.begin(performance.now());
  } else if (phase === 'end') {
    const result = trackpad.end(); if (swipe) finishSwipe(swipe, result.commit);
  } else if (phase === 'cancel') cancelTrackpad();
  else if (phase === 'fallback' && trackpad.explicit) { if (swipe && !swipe.commitRequested) finishSwipe(swipe, false); trackpad.reset(); }
}
function loseGestureFocus() { if (document.visibilityState !== 'visible') cancelTrackpad(); }
let lastTouchAt = 0; let tapAt = 0; let tapX = 0; let tapY = 0;
function doubleClick() { if (Date.now() - lastTouchAt > 700) { window.getSelection()?.removeAllRanges(); toggleControls(); } }

// Must match the per-mode --turn-duration values in style.css.
const TURN_MS: Record<string, number> = { slide: 420, cover: 480, flip: 620, none: 0 };
const reduceMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const currentChapter = computed(() => chapters.value.filter(c => c.offset <= start.value).at(-1)?.title || props.book.title);
const textMargin = computed(() => pageMarginValue(props.pageMargin));
const progress = computed(() => props.book.format === 'pdf' ? (pdfPages.value <= 1 ? 1 : (pdfPage.value - 1) / (pdfPages.value - 1)) : (end.value >= textLength.value ? 1 : start.value / Math.max(1, textLength.value)));
const displayPercent = computed(() => `${Math.round(progress.value * 100)}%`);
const locator = (): Locator => props.book.format === 'txt' ? { type: 'txt', offset: start.value } : { type: 'pdf', page: pdfPage.value - 1, y: 0 };
function report() { emit('position', locator(), progress.value); }
function clearGhost() { clearTimeout(turnTimer); ghost?.remove(); ghost = null; animating.value = false; }
// Snapshot the page that is about to disappear so the outgoing page can animate,
// instead of the content swapping instantly and only the new page moving.
function captureGhost(): HTMLElement | null {
  const paper = page.value;
  if (!paper || props.animation === 'none' || reduceMotion()) return null;
  let node: HTMLElement;
  if (props.book.format === 'txt') {
    if (!text.value) return null;
    node = document.createElement('div'); node.className = 'page-ghost';
    const clone = document.createElement('div'); clone.className = 'page-text'; clone.textContent = text.value;
    node.append(clone);
  } else {
    const source = canvas.value;
    if (!source || !source.width || !source.height) return null;
    const host = paper.getBoundingClientRect(); const rect = source.getBoundingClientRect();
    node = document.createElement('div'); node.className = 'page-ghost ghost-pdf';
    node.style.left = `${rect.left - host.left + paper.scrollLeft}px`;
    node.style.top = `${rect.top - host.top + paper.scrollTop}px`;
    node.style.width = `${rect.width}px`; node.style.height = `${rect.height}px`;
    const bitmap = document.createElement('canvas'); bitmap.width = source.width; bitmap.height = source.height;
    bitmap.getContext('2d')?.drawImage(source, 0, 0);
    bitmap.style.width = '100%'; bitmap.style.height = '100%';
    node.append(bitmap);
  }
  node.setAttribute('aria-hidden', 'true');
  paper.append(node); ghost = node;
  return node;
}
async function playTurn(snapshot: HTMLElement | null, back: boolean) {
  const duration = TURN_MS[props.animation] ?? 0;
  if (!snapshot || !page.value || !duration) { clearGhost(); return; }
  direction.value = back ? 'backward' : 'forward';
  const started = await restartTurnAnimation(animating, nextTick, () => !destroyed && ghost === snapshot, () => { void page.value?.offsetWidth; });
  if (!started) return;
  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => { animating.value = false; ghost?.remove(); ghost = null; }, duration + 80);
}
function fits(a: number, b: number) {
  if (!measure.value) return true;
  measure.value.textContent = readingText(documentText.slice(a, b));
  return measure.value.scrollHeight <= measure.value.clientHeight + 1;
}
async function paginate(reportPosition = true, boundary = textLength.value) {
  await nextTick(); if (destroyed || props.book.format !== 'txt' || !measure.value) return;
  start.value = clampOffset(start.value, textLength.value);
  const best = pageEnd(start.value, textLength.value, chapters.value, fits, boundary);
  end.value = best; if (best > start.value) previousPages.set(best, start.value); text.value = readingText(documentText.slice(start.value, best)); if (reportPosition) report();
}
async function turn(back: boolean) {
  if (loading.value || error.value || preparingTurn || animating.value || props.settingsOpen || swipe) return;
  hideForReading();
  preparingTurn = true;
  try {
    if (props.book.format === 'pdf') {
      const next = pdfPage.value + (back ? -1 : 1); if (next < 1 || next > pdfPages.value) return;
      clearGhost(); await nextTick(); if (destroyed) return; const snapshot = captureGhost();
      pdfPage.value = next; await renderPdf(); report(); if (error.value) { clearGhost(); return; } await playTurn(snapshot, back); return;
    }
    if (back ? start.value === 0 : end.value >= textLength.value) return;
    clearGhost(); await nextTick(); if (destroyed) return; const snapshot = captureGhost();
    const boundary = start.value;
    if (back) start.value = previousPages.get(boundary) ?? previousPageStart(boundary, textLength.value, chapters.value, fits);
    else start.value = end.value;
    await paginate(true, back ? boundary : textLength.value); await playTurn(snapshot, back);
  } finally { preparingTurn = false; }
}
async function jump(offset: number) {
  cancelTrackpad(); clearGhost();
  if (props.book.format === 'pdf') { pdfPage.value = Math.max(1, Math.min(pdfPages.value, offset + 1)); await renderPdf(); report(); }
  else { start.value = offset; await paginate(); }
  showContents.value = false; scheduleControlsHide();
}
async function seek(event: Event) { const value = Number((event.target as HTMLInputElement).value) / 1000; await jump(props.book.format === 'pdf' ? Math.round(value * (pdfPages.value - 1)) : Math.floor(value * (textLength.value - 1))); }
async function renderPdf() {
  const version = ++renderVersion;
  renderTask?.cancel(); await nextTick(); if (!pdf || !canvas.value || !page.value || destroyed) return;
  try {
    const pdfSheet = await pdf.getPage(pdfPage.value); if (version !== renderVersion || destroyed) return;
    const initial = pdfSheet.getViewport({ scale: 1 }); const bounds = page.value.getBoundingClientRect();
    const scale = Math.min((bounds.width - 32) / initial.width, (bounds.height - 20) / initial.height) * zoom.value;
    const viewport = pdfSheet.getViewport({ scale }); const ratio = Math.min(devicePixelRatio || 1, 2);
    const target = canvas.value; target.width = Math.floor(viewport.width * ratio); target.height = Math.floor(viewport.height * ratio);
    target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
    renderTask = pdfSheet.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    await renderTask.promise; if (version === renderVersion && !destroyed) warmPdfNext();
  } catch (err) { if ((err as Error).name !== 'RenderingCancelledException' && !destroyed) error.value = `PDF 渲染失败：${(err as Error).message}`; }
}
async function search() {
  if (!query.value.trim()) return;
  if (props.book.format === 'pdf') { searchInfo.value = '当前版本支持 TXT 全文搜索，PDF 搜索将在后续提供'; return; }
  const offset = documentText.search(query.value, start.value + 1);
  if (offset < 0) { searchInfo.value = '没有找到匹配的文字'; return; }
  searchInfo.value = ''; await jump(offset);
}
function addBookmark() { emit('bookmark', locator(), props.book.format === 'pdf' ? `第 ${pdfPage.value} 页` : `${currentChapter.value} · ${displayPercent.value}`); }
function keydown(event: KeyboardEvent) {
  if ((event.target instanceof Element && event.target.closest('input, select, textarea, button')) || event.altKey || event.metaKey || event.ctrlKey) return;
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(event.key)) { event.preventDefault(); void turn(false); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); void turn(true); }
  if (event.key === 'Escape') { cancelTrackpad(); if (showContents.value || showSearch.value) { showContents.value = false; showSearch.value = false; } else if (controlsVisible.value) emit('close'); else { controlsVisible.value = true; scheduleControlsHide(); } }
}
let touchX = 0; let touchY = 0; let touchAt = 0; let touchCount = 0;
function touchStart(event: TouchEvent) {
  touchCount = event.touches.length; tapAt = touchCount > 1 ? 0 : tapAt;
  touchX = event.touches[0].clientX; touchY = event.touches[0].clientY; touchAt = Date.now();
}
function touchEnd(event: TouchEvent) {
  lastTouchAt = Date.now();
  if (touchCount !== 1 || event.touches.length || window.getSelection()?.toString()) return;
  const point = event.changedTouches[0]; const dx = point.clientX - touchX; const dy = point.clientY - touchY;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.3) { tapAt = 0; void turn(dx > 0); return; }
  if (Math.hypot(dx, dy) > 15 || lastTouchAt - touchAt > 300) { tapAt = 0; return; }
  if (props.edgeTap) {
    const rect = page.value?.getBoundingClientRect();
    const zone = rect ? tapZone(point.clientX, rect.left, rect.width) : 'none';
    if (zone === 'previous' || zone === 'next') {
      tapAt = 0;
      if (!showContents.value && !showSearch.value && !props.settingsOpen && !loading.value && !error.value) void turn(zone === 'previous');
      return;
    }
  }
  if (tapAt && lastTouchAt - tapAt < 320 && Math.hypot(point.clientX - tapX, point.clientY - tapY) < 28) { tapAt = 0; toggleControls(); }
  else { tapAt = lastTouchAt; tapX = point.clientX; tapY = point.clientY; }
}
async function loadText() {
  previousPages.clear();
  try { const decoded = decodeText(new Uint8Array(await props.book.content.arrayBuffer()), encoding.value); documentText = new CodePointText(decoded.text); textLength.value = documentText.length; chapters.value = findChapters(decoded.text); await paginate(false); }
  catch (err) { error.value = `文本解码失败，可切换编码后重试：${(err as Error).message}`; }
}
function chromeAction(event: Event) {
  const message = parseChromeAction((event as CustomEvent).detail); if (!message) return;
  switch (message.action) {
    case 'back': if (showContents.value || showSearch.value) { showContents.value = false; showSearch.value = false; scheduleControlsHide(); } else emit('close'); break;
    case 'contents': showContents.value = !showContents.value; break;
    case 'find': showSearch.value = !showSearch.value; break;
    case 'bookmark': addBookmark(); break;
    case 'previous': void turn(true); break;
    case 'next': void turn(false); break;
    case 'seek': if (typeof message.value === 'number' && Number.isFinite(message.value)) { const value = Math.min(1, Math.max(0, message.value)); void jump(props.book.format === 'pdf' ? Math.round(value * (pdfPages.value - 1)) : Math.floor(value * (textLength.value - 1))); } break;
    case 'encoding': if (['auto', 'utf-8', 'gb18030', 'utf-16le', 'big5'].includes(String(message.value))) encoding.value = String(message.value); break;
    case 'zoom': if ([1, 1.5, 2].includes(Number(message.value))) zoom.value = Number(message.value); break;
    case 'controlsInteracting': nativeInteracting = message.value === true; scheduleControlsHide(); break;
    case 'activity': scheduleControlsHide(); break;
  }
}
watchEffect(() => emit('chrome', {
  title: props.book.title, chapter: props.book.format === 'txt' ? currentChapter.value : `第 ${pdfPage.value} / ${pdfPages.value || '…'} 页`,
  format: props.book.format, progress: loading.value ? props.book.progress : progress.value, encoding: encoding.value, zoom: zoom.value,
  visible: controlsVisible.value, loading: loading.value || !!error.value,
  gestureEnabled: !loading.value && !error.value && !showContents.value && !showSearch.value && !props.settingsOpen
}));
onMounted(async () => {
  window.addEventListener('leaf-trackpad-phase', trackpadPhase); window.addEventListener('blur', cancelTrackpad); document.addEventListener('visibilitychange', loseGestureFocus);
  window.addEventListener('keydown', keydown); window.addEventListener('leaf-native-action', chromeAction);
  try {
    if (props.book.format === 'txt') { start.value = props.book.locator.type === 'txt' ? props.book.locator.offset : 0; await loadText(); }
    else {
      const task = pdfLoading = pdfjs.getDocument({ data: new Uint8Array(await props.book.content.arrayBuffer()), enableXfa: false,
        cMapUrl: new URL('pdf/cmaps/', document.baseURI).href, cMapPacked: true,
        standardFontDataUrl: new URL('pdf/standard_fonts/', document.baseURI).href, wasmUrl: new URL('pdf/wasm/', document.baseURI).href });
      task.onPassword = () => { task.destroy(); error.value = '当前版本暂不支持加密 PDF，请先使用已解密的文件'; };
      pdf = await task.promise; if (destroyed) { await task.destroy(); return; }
      pdfPages.value = pdf.numPages; pdfPage.value = Math.min(pdf.numPages, props.book.locator.type === 'pdf' ? props.book.locator.page + 1 : 1); await renderPdf();
    }
  } catch (err) { error.value ||= `无法打开文件：${(err as Error).message}`; }
  finally { loading.value = false; scheduleControlsHide(); }
  readingBody.value?.addEventListener('wheel', wheel, { passive: false });
  let lastWidth = page.value?.offsetWidth || 0; let lastHeight = page.value?.offsetHeight || 0;
  resize = new ResizeObserver(() => {
    const width = page.value?.offsetWidth || 0; const height = page.value?.offsetHeight || 0;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width; lastHeight = height;
    cancelTrackpad(); clearPdfPreviews(); clearGhost(); previousPages.clear(); clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (props.book.format === 'txt') void paginate(false); else void renderPdf(); }, 120);
  });
  if (page.value) resize.observe(page.value, {box: 'border-box'});
});
watch(() => props.fontSize, () => { cancelTrackpad(); clearGhost(); previousPages.clear(); void paginate(false); });
watch(() => props.pageMargin, () => {
  cancelTrackpad(); clearGhost(); previousPages.clear(); clearTimeout(marginTimer);
  marginTimer = setTimeout(() => { if (props.book.format === 'txt') void paginate(false); }, 80);
});
watch([showContents, showSearch, () => props.settingsOpen], () => { if (showContents.value || showSearch.value || props.settingsOpen) { cancelTrackpad(); controlsVisible.value = true; } scheduleControlsHide(); });
watch(encoding, async () => { cancelTrackpad(); clearGhost(); error.value = ''; await loadText(); });
watch(zoom, () => { cancelTrackpad(); clearPdfPreviews(); clearGhost(); renderPdf(); });
onBeforeUnmount(() => { destroyed = true; cancelTrackpad(); clearPdfPreviews(); window.removeEventListener('leaf-trackpad-phase', trackpadPhase); window.removeEventListener('blur', cancelTrackpad); document.removeEventListener('visibilitychange', loseGestureFocus); ++renderVersion; window.removeEventListener('keydown', keydown); window.removeEventListener('leaf-native-action', chromeAction); resize?.disconnect(); clearTimeout(resizeTimer); clearTimeout(marginTimer); clearTimeout(controlsTimer); readingBody.value?.removeEventListener('wheel', wheel); clearGhost(); renderTask?.cancel(); void pdfLoading?.destroy(); });
</script>

<template>
  <section class="reader" :class="[theme, { 'controls-hidden': !controlsVisible }]" aria-label="阅读器">
    <header v-if="!nativeChrome" class="reader-toolbar" :inert="!controlsVisible" :aria-hidden="!controlsVisible" @pointerdown="scheduleControlsHide" @focusin="scheduleControlsHide">
      <button class="icon-button" aria-label="返回书架" @click="emit('close')">←</button>
      <div class="reader-title"><strong>{{ book.title }}</strong><span>{{ book.format === 'txt' ? currentChapter : `第 ${pdfPage} / ${pdfPages || '…'} 页` }}</span></div>
      <button class="icon-button" aria-label="目录与书签" @click="showContents = !showContents">☷</button>
      <button class="icon-button" aria-label="搜索正文" @click="showSearch = !showSearch">⌕</button>
      <button class="icon-button" aria-label="添加书签" @click="addBookmark">♧</button>
      <button class="icon-button" aria-label="阅读设置" @click="emit('settings')">Aa</button>
    </header>
    <div v-if="showSearch" class="reader-search"><input v-model="query" placeholder="搜索正文，回车查找下一处" aria-label="搜索正文" @keyup.enter="search"/><button @click="search">查找</button><span role="status">{{ searchInfo }}</span></div>
    <aside v-if="showContents" class="contents-panel">
      <div class="panel-heading"><strong>目录与书签</strong><button class="icon-button" aria-label="关闭目录" @click="showContents = false">×</button></div>
      <template v-if="book.format === 'txt'"><button v-for="chapter in chapters" :key="chapter.offset" :class="{selected: currentChapter === chapter.title}" @click="jump(chapter.offset)">{{ chapter.title }}</button></template>
      <div v-else class="pdf-controls"><label>跳转页码<input type="number" :value="pdfPage" :min="1" :max="pdfPages" @change="jump(Number(($event.target as HTMLInputElement).value) - 1)"/></label></div>
      <div class="muted mini-label">书签</div><p v-if="!book.bookmarks.length" class="muted">点击上方书签按钮，留住这一页。</p>
      <button v-for="mark in book.bookmarks" :key="mark.id" @click="jump(mark.locator.type === 'txt' ? mark.locator.offset : mark.locator.page)">{{ mark.label }}</button>
      <details v-if="book.format === 'txt'" class="reader-advanced"><summary>文字显示设置</summary><label class="encoding-control">编码<select v-model="encoding" aria-label="文本编码"><option value="auto">自动</option><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option><option value="utf-16le">UTF-16 LE</option><option value="big5">Big5</option></select></label></details>
    </aside>
    <div ref="readingBody" class="reading-body">
      <div v-if="showReadingHint && !loading && !error" class="reading-hint" role="status">{{ edgeTap ? '左右轻点翻页，双击显示工具栏' : '双击书页显示或隐藏工具栏' }}</div>
      <button class="page-arrow previous" aria-label="上一页" @click="turn(true)">‹</button>
      <div ref="page" class="reading-paper" tabindex="0" :aria-label="edgeTap ? '书页，左右轻点翻页，双击显示或隐藏工具栏' : '书页，双击显示或隐藏工具栏'" :class="[{ 'pdf-paper': book.format === 'pdf', turning: animating }, direction, animation]" :style="{ '--font-size': `${fontSize}px`, '--page-margin': `${textMargin}%` }" @dblclick.prevent="doubleClick" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
        <div v-if="loading" class="reading-message" role="status">正在打开书页…</div>
        <div v-if="error" class="reading-message error" role="alert">{{ error }}</div>
        <template v-if="book.format === 'txt'"><div class="page-text page-content">{{ text }}</div><div ref="measure" class="page-text page-measure" aria-hidden="true"></div></template>
        <canvas v-else ref="canvas" :aria-label="`PDF 第 ${pdfPage} 页`"></canvas>
      </div>
      <button class="page-arrow next" aria-label="下一页" @click="turn(false)">›</button>
    </div>
    <footer v-if="!nativeChrome" class="reader-footer" :inert="!controlsVisible" :aria-hidden="!controlsVisible" @pointerdown="scheduleControlsHide" @focusin="scheduleControlsHide">
      <span>{{ book.format === 'pdf' ? 'PDF' : 'TXT' }}</span>
      
      <label v-if="book.format === 'pdf'" class="encoding-control">缩放<select v-model.number="zoom" aria-label="PDF 缩放"><option :value="1">适合页面</option><option :value="1.5">150%</option><option :value="2">200%</option></select></label>
      <input class="reading-slider" type="range" min="0" max="1000" :value="Math.round(progress * 1000)" aria-label="阅读进度" @change="seek"/>
      <span>{{ displayPercent }}</span><span class="footer-hint">{{ macTrackpad ? '双指横滑 / ← → 翻页' : '← → 翻页' }}</span>
    </footer>
  </section>
</template>
