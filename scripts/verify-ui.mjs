import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.LEAF_PLAYWRIGHT_PACKAGE || 'playwright');
import assert from 'node:assert/strict';
import { fixture } from '../cloud/test/helpers/library-fixture.mjs';
import { writeFile,mkdir } from 'node:fs/promises';
const root=resolve('.');
const f=fixture();const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let maxChunk=0;
async function client() {
 const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:1});
 await context.exposeBinding('leafTestRequest',async(_,raw)=>{
  const m=JSON.parse(raw),a=m.args;
  if(m.method==='updateChrome')return true;
  if(m.method==='getSecret')return 'library-test-only-not-a-real-token-000000000000';
  if(m.method==='cloudRequest')return f.request(a.method,a.path,a.body);
  if(m.method==='blobTransfer'){
   const url=new URL(a.url),path=url.pathname.slice('/leaf-books/'.length);
   if(a.method==='PUT'){const bytes=Buffer.from(a.data,'base64');maxChunk=Math.max(maxChunk,bytes.length);f.chunks.set(`${path}/${url.searchParams.get('blockid')}`,bytes);return{status:201,data:''};}
   const bytes=f.frozen.get(`${path}/${url.searchParams.get('snapshot')}`).subarray(a.start,a.start+a.length);return{status:206,data:bytes.toString('base64')};
  }
  return true;
 });
 await context.addInitScript(()=>{
  window.__leafNativeChrome=true;window.__leafNativePlatform='harmony';
  localStorage.setItem('leaf-initialized','1');localStorage.setItem('leaf-endpoint','https://fixture.azurewebsites.net/api');localStorage.setItem('leaf-theme','sepia');
  window.LeafNative={postMessage:raw=>{const m=JSON.parse(raw);if(m.method==='updateChrome')window.leafTestChrome=m.args.state;window.leafTestRequest(raw).then(result=>window.__leafReply({id:m.id,result})).catch(error=>window.__leafReply({id:m.id,error:error.message}));}};
 });
 const page=await context.newPage();await page.goto('http://127.0.0.1:5173');await page.waitForSelector('.app-shell');return page;
}
const action=(page,action,value)=>page.evaluate(({action,value})=>window.dispatchEvent(new CustomEvent('leaf-native-action',{detail:{action,value}})),{action,value});
try {
 const a=await client();
 await a.locator('input[type=file]').setInputFiles({name:'界面同步测试.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 春日\n\n\n\n\n\n\n\n正文紧跟标题。\n'+'山路的风轻轻吹来，我们继续沿着溪流前行。\n'.repeat(6000)+'\n第二章 夏日\n第二章正文。')});
 await a.waitForFunction(()=>window.leafTestChrome?.syncState==='已同步');
 await a.getByRole('button',{name:'阅读 界面同步测试',exact:true}).click();await a.waitForFunction(()=>window.leafTestChrome?.reader?.loading===false);
 assert.match(await a.locator('.page-content').innerText(),/第一章 春日[\s\S]*正文紧跟标题/);
 const bounds=await a.locator('.reading-paper').boundingBox();assert.ok(bounds.y>=12 && bounds.y<=20);assert.ok(bounds.height/932>.85);
 await mkdir(root+'/build/verification',{recursive:true});await a.screenshot({path:root+'/build/verification/harmony-layout-browser.png'});
 await action(a,'next');await a.waitForTimeout(500);await action(a,'sync');await a.waitForFunction(()=>window.leafTestChrome?.syncState==='已同步');
 const b=await client();await b.getByRole('button',{name:'阅读 界面同步测试',exact:true}).waitFor();assert.match(await b.locator('.book-details').innerText(),/云端书籍/);
 await b.getByRole('button',{name:'阅读 界面同步测试',exact:true}).click();await b.waitForFunction(()=>window.leafTestChrome?.reader?.loading===false);
 assert.ok((await b.locator('.page-content').innerText()).includes('山路的风'));
 assert.ok(!(await b.locator('.page-content').innerText()).includes('第一章 春日'),'new device should resume later page');
 await action(b,'bookmark');await b.getByRole('status').filter({hasText:'已添加书签'}).waitFor();const toast=await b.locator('.toast').boundingBox();assert.ok(toast.y+toast.height<932-84);
 await b.screenshot({path:root+'/build/verification/harmony-toast-browser.png'});
 await action(b,'back');await b.waitForFunction(()=>window.leafTestChrome?.busy===false);await b.locator('.book-menu').click();await b.getByRole('button',{name:'移除下载',exact:true}).click();await b.locator('[aria-labelledby=delete-title]').waitFor({state:'detached'});assert.match(await b.locator('.book-details').innerText(),/云端书籍/);
 await b.getByRole('button',{name:'阅读 界面同步测试',exact:true}).click();await b.waitForFunction(()=>window.leafTestChrome?.reader?.loading===false);await action(b,'back');
 await b.waitForFunction(()=>window.leafTestChrome?.busy===false);await b.locator('.book-menu').click();await b.getByRole('button',{name:'从书库删除',exact:true}).click();await b.getByRole('button',{name:'阅读 界面同步测试',exact:true}).waitFor({state:'detached'});
 await action(a,'back');await action(a,'sync');await a.getByRole('button',{name:'阅读 界面同步测试',exact:true}).waitFor({state:'detached'});
 assert.equal(maxChunk,262144);
 await writeFile(root+'/build/verification/ui-results.json',JSON.stringify({passed:true,checks:['two independent app contexts upload/discover/download','resume remote reading position','title and body share page','text occupies over 85% of viewport height','toast above native dock bounds','remove download and redownload','cloud deletion propagates'],nativeHarmonyDeviceTested:false,safeAreaModel:'Browser viewport represents only native safe content bounds; physical system bars are not simulated'},null,2));
 console.log('Browser UI integration passed: two clients, bounded chunks, remote resume, layout, toast and deletion.');
} finally {await browser.close();}
