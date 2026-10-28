import { auditPublicSource } from './audit-public-source.mjs';
import { cp, mkdir, rm, lstat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const sourceEntries=['.github','src','apps','cloud','scripts','tests','docs','public','README.md','BUGS.md','package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','.gitignore'];
const ignored=new Set(['node_modules','oh_modules','.hvigor','.cache','.local-data','build','dist','.idea','.vscode','.DS_Store','.git','.azure','.ohos','.aws','local.properties','local.settings.json','bin','obj','.vs','TestResults']);
export async function exportPublicSource(destination) {
  const target=resolve(destination);
  // Restrict the destructive refresh to generated source folders under this project.
  if(!target.startsWith(resolve(root,'build')+'/') || target===resolve(root,'build')) throw new Error('Public export must be a generated folder under build/');
  await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
  const filter=async path=>{
    const name=relative(root,path).split('/').join('/'); const parts=name.split('/');const file=parts.at(-1);
    if(parts.some(part=>ignored.has(part)) || file.startsWith('._') || file==='.env' || (file.startsWith('.env.') && file!=='.env.example')) return false;
    if(name==='apps/harmony/build-profile.json5' || name.startsWith('apps/harmony/entry/src/main/resources/rawfile/reader/')) return false;
    if(/\.(p12|p7b|cer|keystore|pem|key|pfx|provisionprofile|mobileprovision|harmonyprovision|hap|log)$/.test(file)) return false;
    if((await lstat(path)).isSymbolicLink()) throw new Error(`Public source cannot contain symbolic links: ${name}`);
    return true;
  };
  for(const entry of sourceEntries) await cp(resolve(root,entry),resolve(target,entry),{recursive:true,force:true,filter});
  await cp(resolve(root,'apps/harmony/build-profile.template.json5'),resolve(target,'apps/harmony/build-profile.json5'));
  const audit=await auditPublicSource(target,root);
  if(!audit.passed) throw new Error(`Public source audit failed: ${JSON.stringify(audit.findings)}`);
  return target;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(await exportPublicSource(process.argv[2] || resolve(root,'build/github/leaf-reader')));
