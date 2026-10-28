import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const {chromium}=createRequire(import.meta.url)(process.env.LEAF_PLAYWRIGHT_PACKAGE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 for(const [theme,color] of [['paper','#f9f8f4'],['sepia','#f4ecd9'],['night','#242b26']]) {
  const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:1});
  await context.addInitScript(theme=>{
   window.__leafNativeChrome=true;window.__leafNativePlatform='harmony';localStorage.setItem('leaf-theme',theme);
   window.LeafNative={postMessage(raw){const m=JSON.parse(raw);queueMicrotask(()=>window.__leafReply({id:m.id,result:m.method==='getSecret'?'':true}));}};
  },theme);
  const page=await context.newPage();await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button',{name:'阅读 山间来信',exact:true}).click();await page.locator('.page-content').filter({hasText:'第一章'}).waitFor();
  await page.waitForTimeout(100);
  await mkdir('build/verification',{recursive:true});
  const image=`build/verification/harmony-background-${theme}.png`;await page.screenshot({path:image});
  // Sample the blank lower edge and both corners: these must match the native theme fill.
  execFileSync('python3',['-c',`from PIL import Image\nim=Image.open(${JSON.stringify(image)}).convert('RGB')\nexpected=tuple(bytes.fromhex('${color.slice(1)}'))\nfor x,y in [(2,930),(215,930),(427,930),(2,900),(427,900)]:\n assert im.getpixel((x,y))==expected,(x,y,im.getpixel((x,y)),expected)\nprint('${theme}: bottom edge matches native ${color}')`],{stdio:'inherit'});
  await context.close();
 }
} finally {await browser.close();}
