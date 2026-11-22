import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { findCodex } from './codex_executable.mjs';

export const validModel = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(id);
export const validEffort = value => ['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value);
let cached, pending;

async function discover(cwd, executable) {
  const child=spawn(executable,['app-server','--listen','stdio://','--disable','plugins','--disable','remote_plugin','--disable','hooks'],
    { cwd,windowsHide:true,stdio:['pipe','pipe','ignore'] });
  const calls=new Map();
  let next=0, stopError;
  function stop(error) {
    stopError=error;
    for(const {reject} of calls.values())reject(error);
    calls.clear();
  }
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{
    let e;
    try{e=JSON.parse(line);}catch{return;}
    if(!calls.has(e.id))return;
    const {resolve,reject}=calls.get(e.id);
    calls.delete(e.id);
    if(e.error)reject(new Error('Codex 未返回模型列表。'));else resolve(e.result);
  });
  child.once('error',()=>stop(new Error('无法启动 Codex 读取模型列表。')));
  child.once('exit',()=>stop(new Error('Codex 模型列表服务已关闭。')));
  child.stdin.on('error',()=>stop(new Error('无法连接 Codex 模型列表服务。')));
  function send(method, params={}, reply=true){
    if(!reply){child.stdin.write(JSON.stringify({method,params})+'\n');return;}
    if(stopError)return Promise.reject(stopError);
    const id=++next;
    return new Promise((resolve,reject)=>{
      calls.set(id,{resolve,reject});
      child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  const timer=setTimeout(()=>{
    stop(new Error('读取 Codex 模型列表超时。'));
    child.kill();
  },6500);
  try{
    await send('initialize',{clientInfo:{name:'paper_desk_models',version:'0.4.0'}});
    send('initialized',{},false);
    const config=send('config/read',{includeLayers:false,cwd}).catch(()=>null);
    const models=new Map();
    let cursor=null, suggested=null;
    for(let i=0;i<5;i++){
      const page=await send('model/list',{limit:60,includeHidden:false,cursor});
      if(!Array.isArray(page?.data))throw new Error('Codex 返回的模型列表无效。');
      for(const row of page.data){
        const id=row.model||row.id;
        if(!validModel(id)||row.hidden||(row.inputModalities?.length&&!row.inputModalities.includes('text')))continue;
        const label=typeof row.displayName==='string'&&row.displayName.trim()?row.displayName.trim().slice(0,120):id;
        const efforts=Array.isArray(row.supportedReasoningEfforts)?
          [...new Set(row.supportedReasoningEfforts.map(x=>x?.reasoningEffort).filter(validEffort))]:[];
        const effort=efforts.length&&!efforts.includes('low')?
          (efforts.includes(row.defaultReasoningEffort)?row.defaultReasoningEffort:efforts[0]):'low';
        models.set(id,{id,label,effort,efforts});
        if(row.isDefault)suggested=id;
      }
      cursor=page.nextCursor;
      if(!cursor)break;
    }
    const cfg=(await config)?.config;
    const configuredModel=validModel(cfg?.model)?cfg.model:null;
    return { models:[...models.values()],defaultModel:configuredModel||suggested,configuredModel };
  }finally{
    clearTimeout(timer);
    lines.close();child.kill();
  }
}

export async function codexCatalog(cwd,executable){
  executable=await findCodex(executable);
  if(cached?.cwd===cwd&&cached.executable===executable&&Date.now()-cached.time<120000)return Promise.resolve(cached.data);
  if(pending?.cwd===cwd&&pending.executable===executable)return pending.result;
  const result=discover(cwd,executable).then(data=>{
    cached={cwd,executable,data,time:Date.now()};
    return data;
  }).finally(()=>{if(pending?.result===result)pending=null;});
  pending={cwd,executable,result};
  return result;
}
