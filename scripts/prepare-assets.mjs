import { cp, mkdir, rm } from 'node:fs/promises';
await rm('public/pdf', { recursive: true, force: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await mkdir('public/pdf', { recursive: true });
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdf/${name}`, { recursive: true });
}
await mkdir('public/licenses', { recursive: true });
await cp('node_modules/pdfjs-dist/LICENSE', 'public/licenses/PDFjs-LICENSE.txt');
await cp('node_modules/vue/LICENSE', 'public/licenses/Vue-LICENSE.txt');
