import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const LIMIT=10*1024*1024;
const formats={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'};
function sniff(b){if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'image/webp';if(b.toString('ascii',0,5)==='%PDF-')return 'application/pdf';return null;}
export async function downloadAttachment(item,{fetchImpl=fetch,token,fail}){
  if(typeof item.file_token!=='string'||!/^[A-Za-z0-9_-]+$/.test(item.file_token))fail('INVALID_ATTACHMENT_TOKEN');
  if(Number(item.size)>LIMIT)fail('ATTACHMENT_TOO_LARGE');
  const url=new URL('https://open.feishu.cn/open-apis/drive/v1/medias/'+encodeURIComponent(item.file_token)+'/download');
  if(item.extra_info)url.searchParams.set('extra',item.extra_info);
  let response;try{response=await fetchImpl(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});}catch{fail('ATTACHMENT_DOWNLOAD_FAILED');}
  if(!response.ok||Number(response.headers.get('content-length'))>LIMIT)fail('ATTACHMENT_DOWNLOAD_FAILED');
  const chunks=[];let size=0;
  try{for await(const part of response.body){size+=part.length;if(size>LIMIT)fail('ATTACHMENT_TOO_LARGE');chunks.push(Buffer.from(part));}}catch{fail('ATTACHMENT_DOWNLOAD_FAILED');}
  const bytes=Buffer.concat(chunks),type=sniff(bytes);if(!type)fail('UNSUPPORTED_ATTACHMENT');
  return {bytes,type};
}
export async function prepareAttachments(records,client,outputDir,roles,fail){
  const result=new Map(),pending=[];
  const names=['上传凭证',...Object.values(roles).map(role=>role+'签字图片')];
  for(const record of records){
    if(record.fields['发布']!==true)continue;
    const needed=names.filter(name=>{const v=record.fields[name];return Array.isArray(v)?v.length>0:v!=null&&v!=='';});
    if(!needed.length)continue;
    const metadata=await client.attachmentMetadata(record.record_id),media={};
    for(const name of needed){
      const id=record.fieldIds?.[name];if(!id)fail('ATTACHMENT_FIELD_MISSING');
      const items=metadata[id];if(!Array.isArray(items)||!items.length||items.length>(name==='上传凭证'?10:1))fail('INVALID_ATTACHMENT_METADATA');
      media[name]=[];
      for(const item of items){
        const {bytes,type}=await client.download(item);
        if(name!=='上传凭证'&&type==='application/pdf')fail('SIGNATURE_IMAGE_REQUIRED');
        const file=createHash('sha256').update(bytes).digest('hex')+'.'+formats[type];
        const publicPath='assets/uploads/'+file;
        media[name].push({url:publicPath,name:String(item.name||'附件').replace(/[\r\n\x00-\x1f]/g,'').slice(0,200),type});
        pending.push({file,bytes});
      }
    }
    result.set(record.record_id,media);
  }
  // All downloads validate before any active snapshot is replaced. Old files are retained.
  if(pending.length){const dir=path.join(outputDir,'assets/uploads');await fs.mkdir(dir,{recursive:true});for(const {file,bytes} of pending)await fs.writeFile(path.join(dir,file),bytes);}
  return result;
}
