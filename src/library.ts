import { cloudRequest, getToken, hasNative, nativeCall } from './bridge';
import { fileHash } from './storage';
import type { Book } from './types';
export interface CloudBook { id:string; title:string; fileName:string; format:'txt'|'pdf'; size:number; color:number; encoding:string; importedAt:string; state:'ready'|'deleted'; updatedAt:string }
export const CHUNK_SIZE=256*1024;
export async function libraryRequest(endpoint:string,method:string,path:string,body?:unknown) {
  const result=await cloudRequest(endpoint,await getToken(),method,path,body);
  if (result.status!==200) throw new Error(result.data.error || '书库同步失败');
  return result.data;
}
export async function listCloudBooks(endpoint:string):Promise<CloudBook[]> { return (await libraryRequest(endpoint,'GET','/v1/library')).books; }
function encode(bytes:Uint8Array) { let raw=''; for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(raw); }
function decode(value:string) { return Uint8Array.from(atob(value),c=>c.charCodeAt(0)); }
async function transfer(url:string,method:'GET'|'PUT',data?:Uint8Array,start?:number,length?:number) {
  if (hasNative()) {
    const result=await nativeCall<{status:number;data:string}>('blobTransfer',{url,method,...(data?{data:encode(data)}:{start,length})});
    if (result.status!==(method==='GET'?206:201)) throw new Error(`文件传输失败（${result.status}），请重试同步`);
    return method==='GET'?decode(result.data):new Uint8Array();
  }
  const result=await fetch(url,{method,headers:{'x-ms-version':'2023-11-03',...(data?{'Content-Type':'application/octet-stream'}:{Range:`bytes=${start}-${start!+length!-1}`})},body:data as BodyInit|undefined,signal:AbortSignal.timeout(45000),redirect:'error'});
  if(result.status!==(method==='GET'?206:201)) throw new Error(`文件传输失败（${result.status}）`);
  return method==='GET'?new Uint8Array(await result.arrayBuffer()):new Uint8Array();
}
async function retry<T>(operation:()=>Promise<T>):Promise<T> {
  for(let n=0;;n++) {try{return await operation();}catch(error){if(n>=2)throw error;await new Promise(resolve=>setTimeout(resolve,500*(n+1)));}}
}
export async function uploadBook(book:Book,endpoint:string,onProgress:(fraction:number)=>void=()=>{}) {
  const path=`/v1/books/${book.id}`;
  const upload=await libraryRequest(endpoint,'PUT',`${path}/upload`,{title:book.title,fileName:book.fileName,format:book.format,size:book.size,color:book.color,encoding:book.encoding,restore:book.restoreCloud===true});
  if(upload.ready) {onProgress(1);return;}
  if(upload.chunkSize!==CHUNK_SIZE) throw new Error('文件传输版本不兼容');
  for(let offset=0,index=0;offset<book.size;offset+=CHUNK_SIZE,index++) {
    const bytes=new Uint8Array(await book.content.slice(offset,offset+CHUNK_SIZE).arrayBuffer());
    const url=new URL(upload.url);url.searchParams.set('comp','block');url.searchParams.set('blockid',btoa(String(index).padStart(6,'0')));
    await retry(()=>transfer(url.toString(),'PUT',bytes));onProgress(Math.min(1,(offset+bytes.length)/book.size));
  }
  await libraryRequest(endpoint,'PUT',`${path}/complete`,{session:upload.session});
}
export async function downloadBook(book:Book,endpoint:string,onProgress:(fraction:number)=>void=()=>{}):Promise<Blob> {
  const response=await libraryRequest(endpoint,'GET',`/v1/books/${book.id}/download`);
  if(response.size!==book.size || response.chunkSize!==CHUNK_SIZE) throw new Error('云端书籍信息已改变，请刷新后重试');
  const chunks:Uint8Array<ArrayBuffer>[]=[];
  for(let start=0;start<book.size;start+=CHUNK_SIZE) {
    const length=Math.min(CHUNK_SIZE,book.size-start);
    const bytes=await retry(()=>transfer(response.url,'GET',undefined,start,length));
    if(bytes.length!==length) throw new Error('下载分块不完整，请重试');
    chunks.push(bytes as Uint8Array<ArrayBuffer>);onProgress((start+length)/book.size);
  }
  const blob=new Blob(chunks,{type:book.format==='pdf'?'application/pdf':'text/plain'});
  if(await fileHash(await blob.arrayBuffer())!==book.id) throw new Error('书籍校验未通过，请重新下载');
  return blob;
}
