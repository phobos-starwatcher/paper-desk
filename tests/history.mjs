// Exercise on-disk persistence across real MCP server restarts with one synthetic QA turn.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { delimiter,join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeTurn } from '../marketplace/plugins/paper-desk/history_store.mjs';
import { codexArgs } from '../marketplace/plugins/paper-desk/codex_model.mjs';

await mkdir('test-output',{recursive:true});
const root=await mkdtemp(resolve('test-output','history-'));
const env={...process.env,PAPER_DESK_ROOT:root,
  PYTHONPATH:resolve('.runtime')+(process.env.PYTHONPATH?delimiter+process.env.PYTHONPATH:'')};
const server=resolve('marketplace/plugins/paper-desk/server.mjs');
let child;
function connect(){
  child=spawn(process.execPath,[server],{env,windowsHide:true,stdio:['pipe','pipe','inherit']});
  const pending=new Map();
  const output=createInterface({input:child.stdout});
  let seq=0;
  output.on('line',line=>{
    const response=JSON.parse(line), resolve=pending.get(response.id);
    if(resolve){pending.delete(response.id);resolve(response.result);}
  });
  return (tool,args)=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('RPC timeout'));},110000);
    pending.set(id,result=>{clearTimeout(timeout);resolve(result);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:tool,arguments:args}})+'\n');
  });
}
function close(){
  return new Promise((resolve,reject)=>{
    child.once('exit',code=>code===0?resolve():reject(new Error('server exited '+code)));
    child.stdin.end();
  });
}
function action(call,name,args,tool='reader_action'){
  return call(tool,{action:name,args}).then(result=>{
    assert.ok(!result.isError,result.content[0].text);
    return result._meta.data;
  });
}
try{
  const demo=join(root,'demo');
  execFileSync(env.PAPER_DESK_PYTHON||'python',[
    resolve('marketplace/plugins/paper-desk/paper_pdf.py'),'demo',demo
  ],{env,windowsHide:true});
  let call=connect();
  const original=join(demo,'original.pdf'), translation=join(demo,'translation.pdf');
  const opened=await call('open_paper',{path:original,translation});
  assert.ok(!opened.isError,opened.content[0].text);
  const {id}=opened.structuredContent;
  await action(call,'share',{id,page:1,actor:'persistence-test'});
  const catalog=await action(call,'models',{id},'reader_read');
  const model=catalog.models.find(m=>m.id===catalog.defaultModel);
  const effort=model?.efforts.includes('medium')?'medium':model?.efforts.find(e=>e!=='low');
  assert.ok(effort,'The default Codex model should support a non-low effort');
  const unsupported=['none','minimal','max','ultra'].find(e=>!model.efforts.includes(e));
  if(unsupported){
    const result=await call('reader_action',{action:'setChatModel',args:{id,model:'',effort:unsupported}});
    assert.ok(result.isError);
    assert.match(result.content[0].text,/不支持/);
  }
  const selected=await action(call,'setChatModel',{id,model:'',effort});
  assert.deepEqual(selected,{chatModel:'',chatEffort:effort});
  assert.ok(codexArgs([],{id:model.id,effort}).includes('model_reasoning_effort="'+effort+'"'));
  const question='示例论文第 2 页，探测器的延时影像记录到这些生物做了什么？';
  const started=await action(call,'ask',{id,page:1,question,background:true});
  assert.equal(started.activity.stage,'reading');
  assert.equal(started.activity.page,2);
  let reply,sawModel=false;
  const deadline=Date.now()+115000;
  while(Date.now()<deadline){
    const s=await action(call,'status',{id},'reader_read');
    assert.equal(s.answerActivity.id,started.activity.id);
    if(s.answerActivity.stage==='error')throw Error(s.answerActivity.message);
    if(s.answerActivity.stage==='generating'){
      sawModel=true;
      assert.deepEqual(s.answerActivity.evidence.pages,[1,2]);
    }
    if(s.answerActivity.stage==='done'){reply=s;break;}
    await delay(175);
  }
  assert.ok(sawModel,'model generation should be visible while the answer is pending');
  assert.equal(reply?.chatCount,1);
  assert.match(reply.chat.at(-1).content,/生长/);
  assert.match(reply.chat.at(-1).content,/分裂/);
  assert.deepEqual(reply.chat.at(-1).evidence,{pages:[1,2],matched:0,hasSelection:false});
  assert.equal(reply.chat.at(-1).model,model.id);
  assert.equal(reply.chat.at(-1).effort,effort);
  const answer=reply.chat.at(-1).content;
  await close();

  call=connect();
  const {papers}=await action(call,'library',{},'reader_read');
  assert.deepEqual(papers.map(({id,page,questionCount,hasTranslation})=>[id,page,questionCount,hasTranslation]),[[id,1,1,true]]);
  const resumed=await action(call,'reopen',{id});
  assert.equal(resumed.shared.page,1);
  assert.equal(resumed.chatCount,1);
  assert.equal(resumed.chat[0].content,question);
  assert.equal(resumed.chat[1].content,answer);
  assert.equal(resumed.chat[1].effort,effort);
  assert.equal(resumed.chatModel,'');
  assert.equal(resumed.chatEffort,effort);
  assert.deepEqual(resumed.chat[1].evidence.pages,[1,2]);
  const same=await call('open_paper',{path:original});
  assert.equal(same.structuredContent.id,id);
  assert.equal(same.structuredContent.phase,'ready');
  assert.deepEqual(same.structuredContent.chat,[],'Archived Q&A should stay out of model-facing tool results');
  await close();

  const folder=join(root,'.paper-desk',id);
  for(let i=0;i<33;i++)await writeTurn(folder,'测试问题 '+i,'测试回答 '+i,'fixture');
  call=connect();
  const page=await action(call,'chatHistory',{id:(await action(call,'reopen',{id})).id},'reader_read');
  assert.equal(page.total,34);
  assert.equal(page.chat.length,60);
  assert.equal(page.before,4);
  const older=await action(call,'chatHistory',{id,before:page.before},'reader_read');
  assert.equal(older.chat.length,8);
  assert.equal(older.chat[0].content,question);
  assert.equal(older.before,null);
  await close();
  console.log('Passed: real answer at '+effort+', saved model and effort, restart restore, duplicate avoidance and older Q&A pagination.');
}catch(e){child?.kill();throw e;}
