import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterBounds, pageEnd, previousPageStart } from '../src/core/pagination.mjs';
import { CodePointText, findChapters } from '../src/core/text.mjs';
test('a short chapter cannot share its page with the next chapter', () => {
  const model = new CodePointText('第一章 开始\n短章。\n第二章 接续\n另一章。'); const chapters = findChapters(model.text);
  const end = pageEnd(0, model.length, chapters, () => true);
  assert.equal(end, chapters[1].offset); assert.ok(!model.slice(0, end).includes('第二章'));
  assert.ok(model.slice(end, pageEnd(end, model.length, chapters, () => true)).startsWith('第二章'));
});
test('preface and chapter boundaries both create new pages, including backward turns', () => {
  const chapters = [{ offset: 5 }, { offset: 17 }, { offset: 24 }];
  const fits = (a, b) => b - a <= 8;
  assert.deepEqual(chapterBounds(chapters, 0, 32), { start: 0, end: 5 });
  assert.equal(pageEnd(0, 32, chapters, fits), 5);
  assert.equal(pageEnd(13, 32, chapters, fits), 17);
  assert.equal(previousPageStart(17, 32, chapters, fits), 9);
  assert.equal(pageEnd(9, 32, chapters, fits, 17), 17);
  assert.equal(previousPageStart(24, 32, chapters, fits), 17);
  assert.equal(pageEnd(17, 32, chapters, fits), 24);
});
test('forward pages cover every code point once and never cross a chapter boundary', () => {
  const model = new CodePointText('开场😀\n第一章 春天\n' + '正文𠮷'.repeat(40) + '\n第二章 夏天\n结束');
  const chapters = findChapters(model.text); const slices = []; let start = 0;
  while (start < model.length) {
    const end = pageEnd(start, model.length, chapters, (a, b) => b - a <= 13);
    assert.ok(end > start); assert.ok(!chapters.some(c => c.offset > start && c.offset < end));
    slices.push(model.slice(start, end)); start = end;
  }
  assert.equal(slices.join(''), model.text);
});

test('chapter title and following body share a page even with excessive source blank lines', async () => {
  const { readingText } = await import('../src/core/text.mjs');
  const model = new CodePointText('第一章 春天\n\n\n\n\n\n\n\n\n\n正文就在标题后。\n第二章 夏天\n下文');
  const chapters = findChapters(model.text);
  const fits = (a,b) => readingText(model.slice(a,b)).split('\n').length <= 5;
  const end = pageEnd(0, model.length, chapters, fits);
  assert.ok(readingText(model.slice(0,end)).includes('正文就在标题后。'));
  assert.equal(end,chapters[1].offset);
});
test('repeated bare chapter number followed by its full title does not create a title-only page', () => {
  const text='第一章\n\n第一章 春天\n正文。\n第二章 夏天\n下文';
  const chapters=findChapters(text);assert.equal(chapters.length,2);assert.equal(chapters[0].offset,0);assert.equal(chapters[0].title,'第一章 春天');
});
