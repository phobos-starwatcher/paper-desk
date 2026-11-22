// Live smoke test; uses the existing Codex login and sends only a tiny synthetic paper.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, delimiter, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

await mkdir('test-output',{recursive:true});
const fixture=await mkdtemp(resolve('test-output','manual-translation-'));
const file=join(fixture,'sample.pdf');
await symlink(resolve('.runtime'),join(fixture,'.runtime'),process.platform==='win32'?'junction':'dir');
process.env.PAPER_DESK_ROOT=fixture;
process.env.PAPER_DESK_TRANSLATOR_PYTHON=resolve('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const { handle, getSession }=await import('../marketplace/plugins/paper-desk/server.mjs');
execFileSync(process.env.PAPER_DESK_PYTHON || 'python',['-c',
  `import sys, pymupdf as f
d=f.open()
p=d.new_page(width=450,height=330)
p.insert_text((38,52),"Broadband photometry",fontname="hebo",fontsize=17)
p.insert_textbox(f.Rect(38,82,415,210),"We use broadband photometry to measure stellar mass in nearby galaxies. The redshift range is 0.01 to 0.08. The redshift is dimensionless. These values are illustrative.",fontsize=11,lineheight=1.3)
d.save(sys.argv[1])
`,file],{env:{...process.env,PYTHONPATH:join(process.cwd(),'.runtime')+(process.env.PYTHONPATH?delimiter+process.env.PYTHONPATH:'')}});
const rpc=(name,args)=>handle({method:'tools/call',params:{name,arguments:args}});
const action=async (name,id,args={},tool='reader_read')=>{
  const result=await rpc(tool,{action:name,args:{id,...args}});
  assert.ok(!result.isError,result.content[0].text);
  return result._meta.data;
};
let session,exit=1;
try {
  const r=await rpc('open_paper',{path:file});
  assert.ok(!r.isError,r.content[0].text);
  session=r.structuredContent;
  assert.equal(session.phase,'original');
  assert.equal(session.progress,undefined);
  assert.equal(session.modelBackend,'codex');
  const data=await readFile(file);
  const upload=await action('upload',undefined,{step:'begin',size:data.length,title:'拖入同一份论文.pdf'},'reader_action');
  await action('upload',undefined,{step:'append',uploadId:upload.uploadId,offset:0,data:data.toString('base64')},'reader_action');
  const dropped=await action('upload',undefined,{step:'finish',uploadId:upload.uploadId},'reader_action');
  assert.equal(dropped.id,session.id);
  assert.equal(dropped.phase,'original');
  assert.equal(dropped.progress,undefined);
  const invalid=await rpc('reader_action',{action:'translate',args:{id:session.id,model:'model-does-not-exist-paper-desk'}});
  assert.ok(invalid.isError);
  const pending=await action('status',session.id);
  assert.equal(pending.phase,'original');
  const {models,defaultModel}=await action('models',session.id);
  const chosen=models.find(m=>m.id==='gpt-6.2-astra')||models.find(m=>m.id!==defaultModel);
  assert.ok(chosen,'a selectable non-default model should be available');
  const effort=chosen.efforts.includes('medium')?'medium':chosen.efforts.find(value=>value!=='low');
  assert.ok(effort,'model catalog should advertise at least one alternative strength');
  const unsupported=['none','minimal','low','medium','high','xhigh','max','ultra'].find(value=>!chosen.efforts.includes(value));
  if(unsupported){
    const rejected=await rpc('reader_action',{action:'translate',args:{id:session.id,model:chosen.id,effort:unsupported}});
    assert.ok(rejected.isError);
    assert.match(rejected.content[0].text,/不支持/);
  }
  const started=await action('translate',session.id,{model:chosen.id,effort},'reader_action');
  assert.equal(started.phase,'translating');
  assert.equal(started.progress.model,chosen.id);
  assert.equal(started.progress.effort,effort);
  assert.equal(started.chatModel,'');
  const stop=Date.now()+135000;
  let last;
  let progressSeen=false;
  while(Date.now()<stop) {
    const status=await action('status',session.id);
    if(last!==status.feedback){console.log(status.phase+': '+status.feedback);last=status.feedback;}
    if(Number.isFinite(status.progress?.percent))progressSeen=true;
    if(status.phase==='error')throw Error(status.feedback);
    if(status.phase==='ready'){
      assert.equal(status.translationModelUsed,chosen.id);
      assert.equal(status.translationEffortUsed,effort);
      assert.deepEqual(JSON.parse(await readFile(join(fixture,'.paper-desk',session.id,'translation-model.json'))),{model:chosen.id,effort});
      assert.ok(progressSeen,'layout engine should publish numeric progress before finishing');
      const page=await action('page',session.id,{page:0});
      assert.equal(page.original.width,page.translation.width);
      assert.equal(page.original.height,page.translation.height);
      const [id,pair]=Object.entries(page.pairs).find(([,p])=>p[0]==='The redshift range is 0.01 to 0.08.')||[];
      assert.match(pair?.[1]||'',/红移.*0\.01.*0\.08/);
      console.log('Passed: manual '+chosen.id+' translation with '+effort+' reasoning, persisted selection, and preserved alignment.');
      exit=0;
      break;
    }
    await wait(1200);
  }
  if(exit)throw Error('Codex translation did not finish in time.');
} catch(e) {
  console.error(e);
} finally {
  if(session && getSession(session.id).phase==='translating'){
    await action('cancel',session.id,{},'reader_action');
    await wait(700);
  }
  process.exit(exit);
}
