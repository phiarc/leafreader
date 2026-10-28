import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
// Run only after reviewing the plan. Uses the currently authenticated Azure CLI identity.
const azBinary=process.env.AZ_BIN || 'az';
const region=process.env.LEAF_AZURE_REGION || 'southeastasia';
const group=process.env.LEAF_RESOURCE_GROUP || 'leaf-reader-dev';
const apply=process.argv.includes('--apply');
function az(args,raw=false) {
  try { const output=execFileSync(azBinary,[...args,'--only-show-errors','-o',raw?'tsv':'json'],{encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','pipe']});return raw?output.trim():JSON.parse(output||'null'); }
  catch(error) { throw new Error(`Azure command failed: ${args.slice(0,3).join(' ')}. ${String(error.stderr||'').replace(/AccountKey=[^;\s]+/g,'AccountKey=[REDACTED]').slice(0,1800)}`); }
}
const account=az(['account','show']);
if(account.name!=='Azure for Students' && !process.env.LEAF_ALLOW_OTHER_SUBSCRIPTION) throw new Error('Expected the Azure for Students subscription; refusing to deploy to a different subscription.');
const suffix=createHash('sha256').update(`${account.id}/${group}`).digest('hex').slice(0,11);
const names={storage:`leaf${suffix}`,cosmos:`leaf-progress-${suffix}`,app:`leaf-sync-${suffix}`};
const plan={subscription:account.name,region,resourceGroup:group,resources:names,cosmos:{freeTier:true,regions:1,sharedThroughput:400},functions:{plan:'Windows Consumption Y1',alwaysOn:false},logs:'Application Insights disabled',booksUploaded:false};
await mkdir('build/cloud',{recursive:true});await writeFile('build/cloud/deployment-plan.json',JSON.stringify(plan,null,2)+'\n');
if(!apply){console.log(JSON.stringify(plan,null,2));console.log('Review the plan, then run with --apply.');process.exit(0);}
const existing=az(['cosmosdb','list']);
if(existing.some(item=>item.enableFreeTier && item.name!==names.cosmos)) throw new Error('A different Cosmos DB account already uses this subscription\'s free tier. Deployment stopped to prevent a billable database.');
console.log('Creating isolated development resource group…');
az(['group','create','--name',group,'--location',region,'--tags','project=leaf-reader','environment=development']);
if(!existing.some(item=>item.name===names.cosmos)) {
  console.log('Creating a single-region Cosmos DB account with Free Tier explicitly enabled…');
  az(['cosmosdb','create','--resource-group',group,'--name',names.cosmos,'--enable-free-tier','true','--default-consistency-level','Session','--locations',`regionName=${region}`,'failoverPriority=0','isZoneRedundant=false']);
}
const cosmos=az(['cosmosdb','show','-g',group,'-n',names.cosmos]);
if(!cosmos.enableFreeTier || cosmos.locations?.length!==1) throw new Error('Cosmos DB free-tier/single-region verification failed.');
az(['cosmosdb','sql','database','create','-g',group,'-a',names.cosmos,'-n','leaf-reader','--throughput','400']);
az(['cosmosdb','sql','container','create','-g',group,'-a',names.cosmos,'-d','leaf-reader','-n','progress','--partition-key-path','/userId']);
console.log('Creating function storage and Consumption function app…');
az(['storage','account','create','-g',group,'-n',names.storage,'-l',region,'--sku','Standard_LRS','--kind','StorageV2','--min-tls-version','TLS1_2','--allow-blob-public-access','false']);
const apps=az(['functionapp','list','-g',group]);
if(!apps.some(item=>item.name===names.app)) az(['functionapp','create','-g',group,'-n',names.app,'--storage-account',names.storage,'--consumption-plan-location',region,'--os-type','Windows','--runtime','node','--runtime-version','22','--functions-version','4','--disable-app-insights','true']);
const app=az(['functionapp','show','-g',group,'-n',names.app]);
const serverPlan=az(['appservice','plan','show','--ids',app.serverFarmId]);
if(serverPlan.sku?.name!=='Y1') throw new Error('Expected a Consumption Y1 plan. Stopped before configuration.');
const credentialPath=resolve('.cache/leaf-sync-connection.json');
let credentials;
try {credentials=JSON.parse(await readFile(credentialPath,'utf8'));}catch{credentials={token:randomBytes(32).toString('base64url')};}
credentials.endpoint=`https://${app.defaultHostName}/api`;
await mkdir('.cache',{recursive:true});await writeFile(credentialPath,JSON.stringify(credentials,null,2)+'\n',{mode:0o600});
const strings=az(['cosmosdb','keys','list','-g',group,'-n',names.cosmos,'--type','connection-strings']);
const settings={FUNCTIONS_EXTENSION_VERSION:'~4',FUNCTIONS_WORKER_RUNTIME:'node',WEBSITE_NODE_DEFAULT_VERSION:'~22',WEBSITE_RUN_FROM_PACKAGE:'1',
  COSMOS_CONNECTION_STRING:strings.connectionStrings[0].connectionString,SYNC_TOKEN_HASH:createHash('sha256').update(credentials.token).digest('hex'),SYNC_USER_ID:'owner'};
const settingsPath=resolve('.cache/leaf-azure-settings.json');await writeFile(settingsPath,JSON.stringify(settings),{mode:0o600});
az(['functionapp','config','appsettings','set','-g',group,'-n',names.app,'--settings',`@${settingsPath}`]);
az(['resource','update','--ids',app.id,'--set','properties.httpsOnly=true','properties.siteConfig.minTlsVersion=1.2','properties.siteConfig.functionAppScaleLimit=1']);
console.log('Deploying the tested synchronization API…');
az(['functionapp','deployment','source','config-zip','-g',group,'-n',names.app,'--src',resolve('build/cloud/leaf-sync.zip'),'--build-remote','false']);
let healthy=false;
for(let attempt=0;attempt<12;attempt++){
  try{const response=await fetch(`${credentials.endpoint}/v1/health`,{headers:{Authorization:`Bearer ${credentials.token}`},signal:AbortSignal.timeout(15000)});if(response.ok && (await response.json()).ok){healthy=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
await writeFile('build/cloud/deployment-result.json',JSON.stringify({...plan,endpoint:credentials.endpoint,healthVerified:healthy,checkedAt:new Date().toISOString()},null,2)+'\n');
console.log(`Endpoint: ${credentials.endpoint}`);
console.log(`Connection code stored privately at ${credentialPath}; it is not printed or bundled into apps.`);
if(!healthy) throw new Error('Resources were created, but API health has not been verified. Inspect deployment before continuing.');
console.log('Authenticated API health verified.');
