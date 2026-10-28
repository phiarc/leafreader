import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const azBinary=process.env.AZ_BIN || (existsSync('.cache/azure-cli/bin/az') ? resolve('.cache/azure-cli/bin/az') : 'az');
const env={...process.env,...(!process.env.AZURE_CONFIG_DIR && existsSync('.cache/azure-config') ? {AZURE_CONFIG_DIR:resolve('.cache/azure-config')} : {})};
function az(args) {
  try { return JSON.parse(execFileSync(azBinary,[...args,'--only-show-errors','-o','json'],{env,encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']})||'null'); }
  catch(error) { throw new Error(`Azure operation failed (${args.slice(0,3).join(' ')}); inspect the operation in Azure Portal. Exit ${error.status}`); }
}
const account=az(['account','show']);
if(account.name!=='Azure for Students') throw new Error('Expected the existing student subscription');
const plan=JSON.parse(await readFile('build/cloud/deployment-plan.json','utf8'));
const {storage,app}=plan.resources; const group=plan.resourceGroup;
if (!process.argv.includes('--code-only')) {
const storageAccount=az(['storage','account','show','-g',group,'-n',storage]);
if(storageAccount.sku.name!=='Standard_LRS' || storageAccount.allowBlobPublicAccess!==false) throw new Error('Unexpected storage configuration');
const identity=az(['functionapp','identity','assign','-g',group,'-n',app]);
az(['role','assignment','create','--assignee-object-id',identity.principalId,'--assignee-principal-type','ServicePrincipal','--role','Storage Blob Data Contributor','--scope',storageAccount.id]);
az(['rest','--method','put','--uri',`https://management.azure.com${storageAccount.id}/blobServices/default/containers/leaf-books?api-version=2023-05-01`,'--body',JSON.stringify({properties:{publicAccess:'None'}})]);
az(['functionapp','config','appsettings','set','-g',group,'-n',app,'--settings',`BOOK_STORAGE_ACCOUNT=${storage}`]);
console.log('Private books container and Function managed identity configured; existing Standard LRS account reused.');
}
az(['functionapp','deployment','source','config-zip','-g',group,'-n',app,'--src',resolve('build/cloud/leaf-sync.zip'),'--build-remote','false']);
await writeFile('build/cloud/library-deployment.json',JSON.stringify({storage,app,container:'leaf-books',private:true,managedIdentity:true,quotaBytes:5*1024**3,deployedAt:new Date().toISOString()},null,2));
console.log('Library API deployed.');
