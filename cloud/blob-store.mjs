import { BlobServiceClient, BlobSASPermissions, SASProtocol } from '@azure/storage-blob';
import { createHash } from 'node:crypto';
// Azure Functions' documented internal managed-identity endpoint; no interactive auth SDK.
export function managedStorageIdentity(environment = process.env, request = fetch) {
  let cached;
  return { async getToken() {
    if (cached && cached.expiresOnTimestamp > Date.now()+5*60000) return cached;
    if (!environment.IDENTITY_ENDPOINT || !environment.IDENTITY_HEADER) throw new Error('Managed identity unavailable');
    const url=new URL(environment.IDENTITY_ENDPOINT);
    url.searchParams.set('resource','https://storage.azure.com/'); url.searchParams.set('api-version','2019-08-01');
    const response=await request(url,{headers:{'X-IDENTITY-HEADER':environment.IDENTITY_HEADER},signal:AbortSignal.timeout(10000),redirect:'error'});
    if (!response.ok) throw new Error('Managed identity request failed');
    const body=await response.json(); const expires=Number(body.expires_on)*1000;
    if (typeof body.access_token!=='string' || !Number.isFinite(expires) || expires<=Date.now()) throw new Error('Invalid managed identity response');
    cached={token:body.access_token,expiresOnTimestamp:expires}; return cached;
  }};
}
export function azureFiles(account) {
  const client=new BlobServiceClient(`https://${account}.blob.core.windows.net`,managedStorageIdentity());
  const container=client.getContainerClient('leaf-books');
  let key;
  async function delegation() {
    if (!key || new Date(key.signedExpiresOn).getTime()<Date.now()+40*60000) key=await client.getUserDelegationKey(new Date(Date.now()-5*60000),new Date(Date.now()+2*60*60000));
    return key;
  }
  return {
    async authorize(book,access) {
      const base=container.getBlobClient(book.blob);
      const blob=access==='read' ? base.withSnapshot(book.snapshot) : base;
      return blob.generateUserDelegationSasUrl({permissions:BlobSASPermissions.parse(access==='read'?'r':'w'),protocol:SASProtocol.Https,
        startsOn:new Date(Date.now()-5*60000),expiresOn:new Date(Date.now()+30*60000)},await delegation());
    },
    async complete(book,blocks) {
      const blob=container.getBlockBlobClient(book.blob);
      await blob.commitBlockList(blocks,{blobHTTPHeaders:{blobContentType:book.format==='pdf'?'application/pdf':'text/plain'}});
      const {snapshot}=await blob.createSnapshot();
      const frozen=blob.withSnapshot(snapshot);
      try {
        const response=await frozen.download();
        if (response.contentLength!==book.size) throw new Error('文件大小不匹配');
        const hash=createHash('sha256'); let size=0;
        for await (const chunk of response.readableStreamBody) { size+=chunk.length; if (size>book.size) throw new Error('文件过大'); hash.update(chunk); }
        if (size!==book.size || hash.digest('hex')!==book.id) { const error=new Error('文件校验失败，请重新上传'); error.status=422; throw error; }
        return snapshot;
      } catch(error) { await frozen.deleteIfExists().catch(()=>{}); throw error; }
    },
    async remove(book) { await container.getBlobClient(book.blob).deleteIfExists({deleteSnapshots:'include'}); }
  };
}
