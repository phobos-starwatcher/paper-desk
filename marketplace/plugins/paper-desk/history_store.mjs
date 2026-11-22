import { createReadStream } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const historyId=id=>typeof id==='string'&&/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(id);
const turnName=/^\d{13}-[a-f0-9-]{36}\.json$/;

export async function fileDigest(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}

export async function readJson(path){
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}

export async function atomicJson(path,value){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{
    const handle=await open(temp,'wx');
    try{await handle.writeFile(JSON.stringify(value),'utf8');await handle.sync();}
    finally{await handle.close();}
    await rename(temp,path);
  }finally{await unlink(temp).catch(()=>{});}
}

export function recordPath(storage,id){return join(storage,id,'reading.json');}
export async function readRecord(storage,id){
  if(!historyId(id))return null;
  const row=await readJson(recordPath(storage,id));
  if(!row||row.version!==1||row.id!==id||typeof row.title!=='string'||
    typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest))return null;
  return row;
}
export async function cachedRecords(storage){
  const dirs=await readdir(storage,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const records=await Promise.all(dirs.filter(d=>d.isDirectory()&&historyId(d.name))
    .map(d=>readRecord(storage,d.name).catch(()=>null)));
  return records.filter(Boolean);
}
export async function checkpoints(folder){
  const [position,model,visit,translationModel]=await Promise.all(['position.json','chat-model.json','visit.json','translation-model.json']
    .map(name=>readJson(join(folder,name)).catch(()=>null)));
  return {position,model,visit,translationModel};
}
export function writeVisit(folder){return atomicJson(join(folder,'visit.json'),{at:Date.now()});}
export function writePosition(folder,page){
  return atomicJson(join(folder,'position.json'),{page,updatedAt:Date.now()});
}
export function writeChoice(folder,choice,effort=''){
  return atomicJson(join(folder,'chat-model.json'),{choice,effort});
}
export function writeTranslationChoice(folder,model,effort){
  return atomicJson(join(folder,'translation-model.json'),{model,effort});
}
export async function turnFiles(folder){
  const files=await readdir(join(folder,'questions')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  return files.filter(name=>turnName.test(name)).sort();
}
export async function writeTurn(folder,question,answer,model,evidence,effort){
  const directory=join(folder,'questions');
  await mkdir(directory,{recursive:true});
  const name=String(Date.now()).padStart(13,'0')+'-'+randomUUID()+'.json';
  const turn=[{role:'user',content:question},{role:'assistant',content:answer,model,evidence,effort}];
  await atomicJson(join(directory,name),turn);
  return {name,turn};
}
export async function refreshTurns(s){
  if(s.demo)return;
  const refresh=(s.chatRefresh||Promise.resolve()).catch(()=>{}).then(async()=>{
    const files=await turnFiles(s.folder);
    for(const name of files){
      if(s.savedTurns.has(name))continue;
      const turn=await readJson(join(s.folder,'questions',name)).catch(()=>null);
      if(Array.isArray(turn)&&turn.length===2&&turn[0]?.role==='user'&&turn[1]?.role==='assistant'
        &&turn.every(m=>typeof m.content==='string'))s.savedTurns.set(name,turn);
    }
    s.chat=files.flatMap(name=>s.savedTurns.get(name)||[]);
  });
  s.chatRefresh=refresh;
  return refresh;
}
export async function readable(path){
  return access(path).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
}
