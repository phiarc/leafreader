import test from 'node:test';
import assert from 'node:assert/strict';
import { CodePointText, findChapters } from '../src/core/text.mjs';
test('sparse offsets preserve all Unicode code-point locators across checkpoints', () => {
  const text = '甲😀乙𠮷\n'.repeat(700); const reference = Array.from(text); const model = new CodePointText(text);
  assert.equal(model.length, reference.length);
  for (let offset = 0, utf16 = 0; offset <= reference.length; offset++) {
    assert.equal(model.toUTF16(offset), utf16); assert.equal(model.toCodePoint(utf16), offset);
    if (offset < reference.length) utf16 += reference[offset].length;
  }
  for (const start of [0, 1, 1023, 1024, 2047, reference.length - 1]) assert.equal(model.slice(start, start + 31), reference.slice(start, start + 31).join(''));
  assert.equal(new CodePointText('').search('未找到', 0), -1);
});
test('search wraps and returns code points without rebuilding the whole text', () => {
  const model = new CodePointText('😀开头\n正文𠮷正文\n第三章');
  assert.equal(model.search('正文', 0), 4); assert.equal(model.search('正文', 5), 7);
  assert.equal(model.search('开头', model.length), 1); assert.equal(model.search('缺失', 0), -1);
  assert.deepEqual(findChapters('😀\n第一章 开始\n' + '正文'.repeat(100000) + '\n第二章 后续').map(c => c.offset), [2, 200010]);
});
test('30 MiB Chinese text uses a compact index and supports tail navigation and search', () => {
  const text = '中'.repeat(10 * 1024 * 1024) + '😀结束'; const model = new CodePointText(text);
  assert.ok(model.checkpoints.byteLength < 50000);
  assert.equal(model.slice(model.length - 3), '😀结束');
  assert.equal(model.search('😀结束', 0), 10 * 1024 * 1024);
  assert.deepEqual(findChapters(text), [{ title: '正文', offset: 0 }]);
});
