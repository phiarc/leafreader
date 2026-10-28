import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { CodePointText, decodeText, findChapters } from '../src/core/text.mjs';

const results = [];
for (const mib of [10, 30]) {
  for (const kind of ['chinese', 'ascii']) {
    const result = (() => {
      const size = mib * 1024 * 1024;
      const paragraph = kind === 'chinese' ? '山间清晨的风穿过林梢，阅读使脚步慢下来。😀\n' : 'Read slowly and keep the next page for tomorrow.\n';
      const pattern = Buffer.from(paragraph);
      const bytes = Buffer.alloc(size);
      for (let offset = 0; offset < size; offset += pattern.length) pattern.copy(bytes, offset, 0, Math.min(pattern.length, size - offset));
      // Do not end the UTF-8 fixture in the middle of a character.
      const valid = bytes.subarray(0, Math.floor(size / pattern.length) * pattern.length);
      globalThis.gc?.();
      const baseline = process.memoryUsage();
      let time = performance.now(); const decoded = decodeText(valid); const decodeMs = performance.now() - time;
      time = performance.now(); const model = new CodePointText(decoded.text); const indexMs = performance.now() - time;
      time = performance.now(); const chapters = findChapters(decoded.text); const chaptersMs = performance.now() - time;
      time = performance.now(); model.search('missing-query', 0); const searchMs = performance.now() - time;
      const tail = model.slice(Math.max(0, model.length - 12000));
      const memory = process.memoryUsage();
      return { mib, kind, bytes: valid.length, codePoints: model.length, indexBytes: model.checkpoints.byteLength,
        decodeMs, indexMs, chaptersMs, searchMs, heapDeltaMiB: (memory.heapUsed - baseline.heapUsed) / 1048576,
        rssDeltaMiB: (memory.rss - baseline.rss) / 1048576, tailCharacters: tail.length, chapterCount: chapters.length };
    })();
    results.push(result); globalThis.gc?.();
  }
}
const report = { environment: { node: process.version, platform: process.platform, architecture: process.arch },
  scope: 'Desktop Node CPU and memory observation; excludes WebView layout, native import, and phone runtime. Memory deltas are observations, not peak guarantees.', results };
await mkdir('build/reports', { recursive: true });
await writeFile('build/reports/text-performance.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
