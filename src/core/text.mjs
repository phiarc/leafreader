// Offsets are Unicode code points in a versioned, normalized text stream.
export const LOCATOR_VERSION = 1;
export function normalizeText(text) { return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC'); }
export function decodeText(bytes, requested = 'auto') {
  if (requested !== 'auto') return { text: normalizeText(new TextDecoder(requested, { fatal: true }).decode(bytes)), encoding: requested };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: normalizeText(new TextDecoder('utf-16le').decode(bytes)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: normalizeText(new TextDecoder('utf-16be').decode(bytes)), encoding: 'utf-16be' };
  try { return { text: normalizeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8' }; }
  catch { return { text: normalizeText(new TextDecoder('gb18030', { fatal: true }).decode(bytes)), encoding: 'gb18030' }; }
}
export function findChapters(text) {
  const chapters = []; let offset = 0;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? text.length : newline;
    // Only short lines can be chapter headings; avoid copying giant paragraphs.
    if (lineEnd - lineStart <= 160) {
      const title = text.slice(lineStart, lineEnd).trim();
      if (title.length <= 80 && /^(第[零〇一二三四五六七八九十百千万\d]+[章节卷回部篇]|[序前后]言|[序终尾]章|引子|楔子|Chapter\s+\d+)/i.test(title)) {
        const previous = chapters.at(-1);
        const bare = previous && /^(第[零〇一二三四五六七八九十百千万\d]+[章节卷回部篇]|Chapter\s+\d+)$/i.test(previous.title);
        if (bare && title.startsWith(previous.title) && text.slice(text.lastIndexOf(previous.title, lineStart - 1) + previous.title.length, lineStart).trim() === '') previous.title = title;
        else chapters.push({ title, offset });
      }
    }
    for (let i = lineStart; i < lineEnd; offset++) i += text.codePointAt(i) > 0xffff ? 2 : 1;
    if (newline < 0) break;
    offset++; lineStart = newline + 1;
  }
  return chapters.length ? chapters : [{ title: '正文', offset: 0 }];
}
export function clampOffset(offset, length) { return Math.min(Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0)), Math.max(0, length - 1)); }
export function escapeHtml(text) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

// Sparse checkpoints preserve code-point locators without one string object per
// character. At most 1023 characters are scanned for any offset conversion.
export class CodePointText {
  constructor(text) {
    this.text = text;
    this.checkpoints = new Uint32Array(Math.floor(text.length / 1024) + 1);
    let count = 0;
    for (let i = 0; i < text.length; count++) {
      if (count % 1024 === 0) this.checkpoints[count / 1024] = i;
      i += text.codePointAt(i) > 0xffff ? 2 : 1;
    }
    this.length = count;
    this.checkpointCount = Math.ceil(count / 1024);
  }
  toUTF16(offset) {
    offset = Math.min(this.length, Math.max(0, Math.floor(offset)));
    if (offset === this.length) return this.text.length;
    const block = Math.floor(offset / 1024);
    let position = this.checkpoints[block];
    for (let n = block * 1024; n < offset; n++) position += this.text.codePointAt(position) > 0xffff ? 2 : 1;
    return position;
  }
  toCodePoint(position) {
    position = Math.min(this.text.length, Math.max(0, Math.floor(position)));
    if (position === this.text.length) return this.length;
    let low = 0; let high = this.checkpointCount - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.checkpoints[mid] <= position) low = mid + 1; else high = mid - 1;
    }
    const block = Math.max(0, high);
    let count = block * 1024;
    for (let i = this.checkpoints[block]; i < position; count++) i += this.text.codePointAt(i) > 0xffff ? 2 : 1;
    return count;
  }
  slice(start, end = this.length) { return this.text.slice(this.toUTF16(start), this.toUTF16(end)); }
  search(query, after) {
    let position = this.text.indexOf(query, this.toUTF16(after));
    if (position < 0) position = this.text.indexOf(query);
    return position < 0 ? -1 : this.toCodePoint(position);
  }
}

export function readingText(text) { return text.replace(/(?:[ \t\u3000]*\n){3,}/g, '\n\n'); }
