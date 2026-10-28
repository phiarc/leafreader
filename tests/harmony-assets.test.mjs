import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { collectHarmonyAssets, renderHarmonyManifest } from '../scripts/harmony-assets.mjs';

test('packaged module scripts resolve to a local rawfile with a JavaScript MIME type',async()=>{
  const root=await mkdtemp(join(tmpdir(),'leaf-harmony-assets-'));
  try {
    await mkdir(join(root,'assets'));
    await writeFile(join(root,'index.html'),'<script type="module" crossorigin src="./assets/app.mjs"></script><link rel="stylesheet" href="./assets/app.css">');
    await writeFile(join(root,'assets/app.mjs'),'export const ready = true;');
    await writeFile(join(root,'assets/app.css'),'body { color: green; }');
    const assets=await collectHarmonyAssets(root); const byPath=new Map(assets.map(item=>[item.urlPath,item]));
    const html=await readFile(join(root,'index.html'),'utf8');
    for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url=new URL(match[1],'https://leaf-reader.invalid/reader/index.html');
      const asset=byPath.get(url.pathname); assert.ok(asset,`Unmapped local resource: ${url.pathname}`);
      assert.equal(asset.mimeType,url.pathname.endsWith('.mjs')?'text/javascript':'text/css');
      assert.ok((await stat(join(root,asset.rawfile.replace(/^reader\//,'')))).isFile());
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test('the generated native allowlist includes correct worker, Wasm and binary resource types',async()=>{
  const root=await mkdtemp(join(tmpdir(),'leaf-harmony-pdf-'));
  try {
    await mkdir(join(root,'pdf'));
    for(const file of ['pdf.worker.mjs','decoder.wasm','map.bcmap']) await writeFile(join(root,'pdf',file),'fixture');
    const entries=await collectHarmonyAssets(root);const manifest=renderHarmonyManifest(entries);
    assert.equal(entries.find(item=>item.urlPath.endsWith('.mjs')).mimeType,'text/javascript');
    assert.equal(entries.find(item=>item.urlPath.endsWith('.wasm')).mimeType,'application/wasm');
    assert.equal(entries.find(item=>item.urlPath.endsWith('.bcmap')).mimeType,'application/octet-stream');
    assert.ok(manifest.includes('export const LOCAL_ASSETS'));
    assert.ok(manifest.includes('export const LOCAL_MIME_TYPES'));
    for(const entry of entries) assert.ok(manifest.includes(JSON.stringify(entry.urlPath)));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('every entry point in the real packaged reader is served by the native resource allowlist',async()=>{
  const root=resolve('apps/harmony/entry/src/main/resources/rawfile/reader');
  const entries=JSON.parse(await readFile(join(root,'asset-manifest.json'),'utf8'));
  const byPath=new Map(entries.map(item=>[item.urlPath,item]));
  const html=await readFile(join(root,'index.html'),'utf8');
  assert.ok(byPath.has('/reader/index.html'));
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url=new URL(match[1],'https://leaf-reader.invalid/reader/index.html');
    assert.equal(url.origin,'https://leaf-reader.invalid');
    assert.ok(byPath.has(url.pathname),`Missing asset ${url.pathname}`);
  }
  for(const entry of entries) {
    const file=resolve(root,entry.rawfile.replace(/^reader\//,''));
    assert.ok(file.startsWith(root+'/'));
    assert.ok((await stat(file)).isFile());
  }
});
