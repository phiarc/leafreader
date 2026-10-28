import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.LEAF_PLAYWRIGHT_PACKAGE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1180,height:830}});
 await context.addInitScript(()=>{
  window.__leafNativeChrome=true;window.__leafNativePlatform='macos';
  localStorage.setItem('leaf-initialized','1');
  window.webkit={messageHandlers:{leaf:{postMessage(raw){const m=JSON.parse(raw);if(m.method==='updateChrome')window.leafTestChrome=m.args.state;queueMicrotask(()=>window.__leafReply({id:m.id,result:m.method==='getSecret'?'':true}));}}}};
 });
 const page=await context.newPage();await page.goto('http://127.0.0.1:5173');
 await page.locator('input[type=file]').setInputFiles({name:'留白验证.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 春日\n\n'+('清风穿过书页，我们慢慢沿着山路继续向前。'.repeat(8)+'\n').repeat(300))});
 await page.getByRole('button',{name:'阅读 留白验证',exact:true}).click();await page.waitForFunction(()=>window.leafTestChrome?.reader?.loading===false);
 const action=(margin)=>page.evaluate(value=>window.dispatchEvent(new CustomEvent('leaf-native-action',{detail:{action:'preferences',value:{pageMargin:value}}})),margin);
 const geometry=()=>page.locator('.page-content').evaluate(e=>({width:e.getBoundingClientRect().width,padding:parseFloat(getComputedStyle(e).paddingLeft),text:e.textContent}));
 await action(0);await page.waitForTimeout(120);const wide=await geometry();assert.ok(wide.width>900);assert.equal(wide.padding,0);
 await action(23.7);await page.waitForTimeout(120);const narrow=await geometry();assert.ok(Math.abs(narrow.padding/narrow.width-.237)<.001);assert.ok(narrow.text.length<wide.text.length);assert.ok(narrow.text.startsWith('第一章 春日'));
 await page.reload();await page.getByRole('button',{name:'阅读 留白验证',exact:true}).click();await page.waitForFunction(()=>window.leafTestChrome?.reader?.loading===false);const restored=await geometry();assert.ok(Math.abs(restored.padding/restored.width-.237)<.001);
 await action(35);await page.waitForTimeout(120);assert.ok((await geometry()).text.length>0);
 await mkdir('build/verification',{recursive:true});await page.screenshot({path:'build/verification/macos-margins.png'});
 await writeFile('build/verification/margin-results.json',JSON.stringify({passed:true,checks:['0 percent uses available Mac page width','23.7 percent changes wrapping without losing current text','setting survives reload','35 percent remains readable']},null,2));
 console.log('Mac margin rendering, repagination and persistence passed.');
} finally {await browser.close();}
