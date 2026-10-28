// Chapter offsets and page positions always use normalized Unicode code points.
export function chapterBounds(chapters, offset, length) {
  let low = 0; let high = chapters.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (chapters[mid].offset <= offset) low = mid + 1; else high = mid;
  }
  return { start: low ? chapters[low - 1].offset : 0, end: low < chapters.length ? chapters[low].offset : length };
}
export function pageEnd(start, length, chapters, fits, boundary = length) {
  const limit = Math.min(length, chapterBounds(chapters, start, length).end, boundary);
  if (start >= limit) return limit;
  let low = start + 1; let high = Math.min(limit, start + 12000); let best = low;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(start, mid)) { best = mid; low = mid + 1; } else high = mid - 1;
  }
  return best;
}
export function previousPageStart(boundary, length, chapters, fits) {
  if (boundary <= 0) return 0;
  const chapter = chapterBounds(chapters, boundary - 1, length);
  let low = Math.max(chapter.start, boundary - 12000); let high = boundary - 1; let best = high;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid, boundary)) { best = mid; high = mid - 1; } else low = mid + 1;
  }
  return best;
}
