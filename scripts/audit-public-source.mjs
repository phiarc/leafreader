import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, userInfo } from 'node:os';
const project=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function auditPublicSource(directory, privateRoot=project) {
  const target=resolve(directory);const needles=new Map();
  const add=(value,kind)=>{if(typeof value==='string' && value.length>=12)needles.set(value,kind);};
  add(homedir(),'personal home directory');
  const username=userInfo().username;if(username.length>=4)needles.set(username,'personal system username');
  for(const name of ['.cache/leaf-sync-connection.json','.cache/leaf-azure-settings.json','.cache/azure-config/azureProfile.json','apps/harmony/build-profile.json5']) {
    let body;try {body=JSON.parse((await readFile(resolve(privateRoot,name),'utf8')).replace(/^\uFEFF/,''));}catch {continue;}
    function collect(value,key='') {
      if(Array.isArray(value)){for(const item of value)collect(item,key);return;}
      if(value && typeof value==='object'){for(const [k,v]of Object.entries(value))collect(v,`${key}/${k}`);return;}
      if(typeof value!=='string')return;
      if(/token|secret|password|connection.string|endpoint|certpath|storefile|profile$|keyalias|tenantid|\/id$|\/user\/name$/i.test(key)) add(value,'local private configuration');
      if(/endpoint/i.test(key))try{add(new URL(value).hostname,'deployed service address');}catch{}
      if(/connection.string/i.test(key))for(const part of value.split(';')){const at=part.indexOf('=');if(at>0)add(part.slice(at+1),'service connection component');}
    }
    collect(body);
  }
  const excluded=new Set(['.cache','.azure','.aws','.ohos','node_modules','oh_modules','.hvigor','.idea','.vscode','dist','build','.local-data','bin','obj','.vs','TestResults']);
  const findings=[];let files=0,bytes=0;
  async function walk(folder) {
    for(const entry of await readdir(folder,{withFileTypes:true})) {
      if(entry.name==='.git')continue;
      const path=resolve(folder,entry.name);const name=relative(target,path);
      if(entry.isSymbolicLink()){findings.push({path:name,issue:'symbolic link'});continue;}
      if(entry.isDirectory()) {if(excluded.has(entry.name))findings.push({path:name,issue:'private or generated directory'});else await walk(path);continue;}
      if(!entry.isFile())continue;
      files++;const buffer=await readFile(path);bytes+=buffer.length;
      if(/\.(p12|p7b|cer|keystore|pem|key|pfx|provisionprofile|mobileprovision|harmonyprovision|hap|log)$/.test(entry.name) || entry.name==='.DS_Store' || entry.name.startsWith('._') || /^\.env(?:\.|$)/.test(entry.name) && entry.name!=='.env.example') findings.push({path:name,issue:'private file type'});
      for(const [needle,kind]of needles)if(buffer.includes(Buffer.from(needle)))findings.push({path:name,issue:kind});
      if(/\.(?:mjs|ts|ets|swift|cs|csproj|manifest|ps1|json5?|md|txt|html|css|ya?ml|sh|plist)$/.test(entry.name) || entry.name==='.gitignore') {
        const text=buffer.toString('utf8');
        for(const [issue,pattern]of [
          ['private key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
          ['GitHub access token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
          ['literal Azure account key',/AccountKey=[A-Za-z0-9+/=]{30,}/],
          ['personal filesystem path',/(?:\/Users\/[^/\s]+\/|[A-Z]:\\Users\\[^\\\s]+\\)/],
          ['email address',/(?<![A-Za-z0-9_.+-])[A-Za-z0-9_.+-]+@(?!example\.(?:com|invalid)\b|users\.noreply\.github\.com\b|2x\.png\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/]
        ])if(pattern.test(text))findings.push({path:name,issue});
      }
      if(name==='apps/harmony/build-profile.json5') {
        try {if(JSON.parse(buffer.toString()).app.signingConfigs.length) findings.push({path:name,issue:'nonempty device signing configuration'});}catch {findings.push({path:name,issue:'unrecognized signing configuration'});}
      }
    }
  }
  await walk(target);
  const unique=[...new Map(findings.map(item=>[JSON.stringify(item),item])).values()];
  return {passed:unique.length===0,files,bytes,findings:unique};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const result=await auditPublicSource(process.argv[2] || resolve(project,'build/github/leaf-reader'));
 console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
