import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
test('three-page PDF fixture parses and exposes text and page geometry',async()=>{
  const task=getDocument({standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).split(sep).join('/'),data:new Uint8Array(await readFile(new URL('./fixtures/阅读器验证.pdf',import.meta.url)))});
  const pdf=await task.promise;
  assert.equal(pdf.numPages,3);
  const page=await pdf.getPage(2); const text=await page.getTextContent();
  assert.ok(text.items.some(item=>item.str==='Page 2 of 3'));
  assert.equal(page.getViewport({scale:1}).width,420);
  await task.destroy();
});
