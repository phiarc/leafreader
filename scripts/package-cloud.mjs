import { cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const directory = 'build/cloud/package';
await rm(directory,{recursive:true,force:true});
await mkdir(directory,{recursive:true});
// Recreate the ZIP so removed server files cannot linger.
await (await import('node:fs/promises')).rm('build/cloud/leaf-sync.zip',{force:true});
for(const file of ['azure.mjs','service.mjs','library.mjs','blob-store.mjs','host.json','package.json','package-lock.json','node_modules']) await cp(`cloud/${file}`,`${directory}/${file}`,{recursive:true,force:true});
execFileSync('/usr/bin/zip',['-q','-r','../leaf-sync.zip','.'],{cwd:directory});
await writeFile('build/cloud/README.txt','Azure Functions deployment package. No credentials or books are included.\n');
console.log('Cloud package ready: build/cloud/leaf-sync.zip');
