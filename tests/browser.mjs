import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '../test-output/browser/node_modules/playwright-core/index.mjs';
import { handle, getSession, popup, saveTranslation } from '../marketplace/plugins/paper-desk/server.mjs';

const edge = process.env.PAPER_DESK_TEST_BROWSER ||
  join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const resource = await handle({ method: 'resources/read', params: { uri:'ui://paper-desk/reader.html' } });
const app = resource.contents[0].text;
let sessionId;
let draft;
let questionRequest;
let finishQuestion;
let translationRequest;
const savePath=resolve('test-output','读论文 · 中文 '+Date.now()+'.pdf');
const host = createServer(async(req,res) => {
  if (req.url === '/app') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.end(app);
  }
  if (req.url === '/mcp') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = JSON.parse(Buffer.concat(chunks).toString());
    let data;
    if (r.method === 'ui/initialize') data = { protocolVersion:'2026-01-26' };
    else if (r.method === 'ui/message') { draft=r.params; data={}; }
    else if (r.params?.arguments?.action === 'library') {
      const s=getSession(sessionId);
      data={_meta:{data:{papers:[{id:sessionId,title:s.title,pages:s.pages,page:s.shared.page,
        hasTranslation:true,questionCount:s.chat.length/2,openedAt:Date.now()}]}}};
    } else if(r.params?.arguments?.action==='reopen'){
      data=await handle({method:'tools/call',params:{name:'reader_read',arguments:{action:'status',args:{id:sessionId}}}});
    }
    else if (r.params?.arguments?.action === 'models') {
      data={_meta:{data:{defaultModel:'demo-astra',configuredModel:'demo-astra',models:[
        {id:'demo-astra',label:'演示模型',effort:'low',efforts:['low','medium']},
        {id:'test-translation',label:'Fixture Translation',effort:'low',efforts:['low','high']}]}}};
    } else if (r.params?.arguments?.action === 'setChatModel') {
      const {model:id,effort}=r.params.arguments.args,s=getSession(sessionId);
      s.chatModel=id?{id}:null;
      s.chatEffort=effort;
      data={_meta:{data:{chatModel:id,chatEffort:effort}}};
    }
    else if (r.params?.arguments?.action === 'ask') {
      questionRequest=r.params.arguments.args;
      const s=getSession(sessionId);
      const evidence={pages:[1,2],matched:1,hasSelection:true};
      s.answerActivity={id:'fixture-answer',stage:'generating',page:1,evidence};
      data={_meta:{data:{activity:s.answerActivity}}};
      finishQuestion=()=>{
        s.answerActivity.stage='done';
        s.chat=[{role:'user',content:questionRequest.question},
          {role:'assistant',model:s.chatModel?.id,effort:s.chatEffort,content:'示例回答：目标区的 40 个观测时段中有 32 次检出，检出率为 80%（第 1 页，图 1）。',evidence}];
      };
    } else if (r.params?.arguments?.action === 'upload') {
      const a=r.params.arguments.args, s=getSession(sessionId);
      if(a.step==='begin')data={_meta:{data:{uploadId:'fixture-drop'}}};
      if(a.step==='append')data={_meta:{data:{offset:Buffer.from(a.data,'base64').length+a.offset}}};
      if(a.step==='finish'){
        s.translation='';s.phase='original';s.revision++;s.cache.clear();
        data=await handle({method:'tools/call',params:{name:'reader_read',arguments:{action:'status',args:{id:sessionId}}}});
      }
    } else if(r.params?.arguments?.action==='translate'){
      translationRequest=r.params.arguments.args;
      const s=getSession(sessionId);
      s.phase='translating';s.translationModel=translationRequest.model;
      s.progress={percent:0,stage:'正在准备翻译',completed:0,model:translationRequest.model,effort:translationRequest.effort};
      data=await handle({method:'tools/call',params:{name:'reader_read',arguments:{action:'status',args:{id:sessionId}}}});
    } else if (r.params?.arguments?.action === 'saveAs') {
      data={_meta:{data:await saveTranslation(getSession(sessionId),async()=>savePath)}};
    } else {
      data = await handle(r);
      if (r.params?.arguments?.action === 'demo') sessionId = data?._meta?.data?.id;
    }
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify(data));
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end(`<html><body style="margin:0"><iframe id="app" src="/app" style="width:100%;height:100vh;border:0"></iframe>
    <script>addEventListener('message',async e=>{
      if(e.source!==document.getElementById('app').contentWindow||e.data.id===undefined)return;
      try{
        const response=await fetch('/mcp',{method:'POST',body:JSON.stringify(e.data)});
        e.source.postMessage({jsonrpc:'2.0',id:e.data.id,result:await response.json()},'*');
      }catch(error){e.source.postMessage({jsonrpc:'2.0',id:e.data.id,error:{message:String(error)}},'*');}
    });</script></body></html>`);
});
await new Promise(resolve => host.listen(0,'127.0.0.1',resolve));
const appURL = 'http://127.0.0.1:' + host.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath:edge, headless:true, args:['--disable-gpu','--disable-extensions'] });
  const context = await browser.newContext({viewport:{width:1540,height:980}});
  const screen = await context.newPage();
  const pageErrors = [];
  screen.on('pageerror',e=>pageErrors.push(e.message));
  await screen.goto(appURL);
  const view=screen.frameLocator('#app');
  await view.locator('#welcome-demo').click();
  const firstPage=' .page[data-page="0"]';
  const secondPage=' .page[data-page="1"]';
  await view.locator('#translation'+firstPage+' img').waitFor();
  assert.ok(sessionId);
  const select=view.locator('#chat-model');
  const chatEffort=view.locator('#chat-effort');
  await chatEffort.locator('option[value=medium]').waitFor({state:'attached'});
  assert.equal(await select.inputValue(),'');
  await chatEffort.selectOption('medium');
  await select.selectOption('test-translation');
  assert.deepEqual(await chatEffort.locator('option').evaluateAll(items=>items.map(i=>i.value)),['','low','high']);
  assert.equal(await chatEffort.inputValue(),'');
  await select.selectOption('demo-astra');
  assert.equal(await select.inputValue(),'demo-astra');
  await chatEffort.selectOption('medium');
  const visual=await view.locator('#original'+firstPage+' img').evaluate(async e=>{await e.decode();return e.naturalHeight;});
  assert.ok(visual>1000);
  await view.locator('#original'+secondPage+' img').waitFor();
  assert.equal(await view.locator('#original .page').count(),2);
  // Both real pages are mounted in document flow. A wheel scroll follows the same page in each column.
  const firstBox=await view.locator('#original'+firstPage).boundingBox();
  const secondBox=await view.locator('#original'+secondPage).boundingBox();
  assert.ok(secondBox.y>=firstBox.y+firstBox.height);
  await view.locator('#original-scroll').hover();
  await screen.mouse.wheel(0,1050);
  await view.locator('#page-number').evaluate(e=>new Promise((resolve,reject)=>{
    const started=Date.now(), check=()=>e.value==='2'?resolve():Date.now()-started>2500?reject(new Error('wheel did not advance')):requestAnimationFrame(check);
    check();
  }));
  assert.ok(await view.locator('#translation-scroll').evaluate(e=>e.scrollTop)>200);
  await view.locator('#prev').click();
  assert.equal(await view.locator('#page-number').inputValue(),'1');
  const { _meta } = await handle({method:'tools/call',params:{name:'reader_read',arguments:{action:'page',args:{id:sessionId,page:0}}}});
  const result = _meta.data;
  const id=Object.keys(result.pairs).find(i=>result.pairs[i][0]==='We detected repeating light pulses in 32 of 40 observing windows.');
  assert.equal(result.pairs[id]?.[1],'在 40 个观测时段中，有 32 次检出重复光脉冲。');
  async function drag(side, pair, browserPage=screen, reader=view) {
    const flat=result[side].rows.flat();
    const glyphs=flat.flatMap((glyph,i)=>glyph[5]===pair&&!/^\s+$/.test(glyph[0])?[i]:[]);
    const from=await reader.locator('#'+side+firstPage+' [data-i="'+glyphs[1]+'"]').boundingBox();
    const to=await reader.locator('#'+side+firstPage+' [data-i="'+glyphs.at(-2)+'"]').boundingBox();
    assert.ok(from&&to);
    await browserPage.mouse.move(from.x+from.width/2,from.y+from.height/2);
    await browserPage.mouse.down();
    await browserPage.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});
    await browserPage.mouse.up();
  }
  const foot=view.locator('#foot-text');
  await drag('original',id);
  assert.match(await foot.textContent(),/已联动高亮 1 组句子/);
  assert.ok(await view.locator('#translation .marker-layer s:not(.picked)').count());
  assert.ok(await view.locator('#original .picked').count());
  await drag('translation',id);
  assert.ok(await view.locator('#original .marker-layer s:not(.picked)').count());
  assert.ok(await view.locator('#translation .picked').count());
  const question='M78 目标区的脉冲检出率是多少？';
  await view.locator('#question').fill(question);
  await view.locator('#send').click();
  await view.locator('#answer-state').filter({hasText:'思考中'}).waitFor();
  await view.locator('#answer-step').filter({hasText:'正在生成回答'}).waitFor();
  await view.locator('#answer-evidence').filter({hasText:'提供给模型的原文页：1、2 · 已带入 1 组对照选文'}).waitFor();
  assert.equal(await view.locator('#send').isDisabled(),true);
  assert.equal(await chatEffort.isDisabled(),true);
  finishQuestion();
  await view.locator('#chat-log').getByText('检出率为 80%', {exact:false}).waitFor();
  await view.locator('#answer-activity').waitFor({state:'hidden'});
  await view.locator('#chat-log .answer-context').filter({hasText:'提供给模型的原文页：1、2'}).waitFor();
  await view.locator('#chat-log').getByText('demo-astra · 中',{exact:true}).waitFor();
  assert.deepEqual(questionRequest.ids,[id]);
  assert.equal(questionRequest.page,0);
  assert.match(questionRequest.selectedText,/40[\s\S]*32/);
  if(process.env.PAPER_DESK_DOCS_SCREENSHOT==='1')await screen.screenshot({path:'docs/images/reader-demo.png'});
  await view.locator('#question').fill(question);
  await view.locator('#draft').click();
  await view.locator('#notice').filter({hasText:'输入框'}).waitFor();
  assert.match(draft.content[0].text,/40[\s\S]*32/);
  assert.equal(draft._meta['openai/message'].send,false);
  await view.locator('#recent').click();
  await view.locator('#history-filter').fill('不存在的文章');
  await view.locator('#history-list').getByText('没有符合标题的文档。').waitFor();
  await view.locator('#history-filter').fill('奥特曼望远镜');
  await view.locator('#history-list').getByText('1 条问答',{exact:false}).waitFor();
  await view.locator('#history-list').getByRole('button',{name:'查看问答'}).click();
  await view.locator('#history').waitFor({state:'hidden'});
  assert.equal(await view.locator('#chat-log').evaluate(e=>e===document.activeElement),true);
  const synthetic=getSession(sessionId);
  synthetic.phase='translating';synthetic.progress={percent:47,stage:'Codex 正在翻译',completed:3};
  await view.locator('#progress-number').filter({hasText:'47%'}).waitFor();
  assert.equal(await view.locator('#progress-bar').getAttribute('value'),'47');
  synthetic.phase='ready';delete synthetic.progress;
  await view.locator('#translation-progress').waitFor({state:'hidden'});
  await view.locator('#save-as').click();
  await view.locator('#notice').filter({hasText:'已保存译文'}).waitFor();
  assert.deepEqual(await readFile(savePath),await readFile(synthetic.translation));
  assert.deepEqual(await saveTranslation(synthetic,async()=>''),{cancelled:true});
  await assert.rejects(saveTranslation(synthetic,async()=>synthetic.source),/不能覆盖/);
  const widthBefore=(await view.locator('#original').boundingBox()).width;
  const split=await view.locator('#split-a').boundingBox();
  await screen.mouse.move(split.x+2,split.y+100);
  await screen.mouse.down();await screen.mouse.move(split.x+92,split.y+100,{steps:8});await screen.mouse.up();
  assert.ok((await view.locator('#original').boundingBox()).width>widthBefore+70);
  await screen.screenshot({path:'test-output/reader.png'});
  const remote=await popup(getSession(sessionId),'translation',false);
  const second=await context.newPage();
  await second.setViewportSize({width:840,height:900});
  second.on('pageerror',e=>pageErrors.push(e.message));
  await second.goto(remote.url);
  await second.locator('#translation'+firstPage+' img').waitFor();
  await second.locator('#translation .marker-layer s').first().waitFor();
  assert.equal(await second.locator('#original').isVisible(),false);
  await second.locator('#next').click();
  await view.locator('#page-number').evaluate(e=>new Promise((resolve,reject)=>{
    const started=Date.now(), check=()=>e.value==='2'?resolve():Date.now()-started>2500?reject(new Error('popup did not advance')):requestAnimationFrame(check);
    check();
  }));
  await view.locator('#prev').click();
  await second.waitForFunction(()=>document.getElementById('page-number').value==='1');
  await second.close();
  await view.locator('body').evaluate(el=>{
    const drop=new DataTransfer();
    drop.items.add(new File(['%PDF-fixture'],'拖入论文.pdf',{type:'application/pdf'}));
    el.dispatchEvent(new DragEvent('drop',{dataTransfer:drop,bubbles:true,cancelable:true}));
  });
  const translationModel=view.locator('#translation-model');
  await translationModel.waitFor();
  assert.equal(translationRequest,undefined);
  assert.equal(await view.locator('#translation-progress').isHidden(),true);
  await translationModel.selectOption('test-translation');
  const effort=view.locator('#translation-effort');
  assert.deepEqual(await effort.locator('option').evaluateAll(items=>items.map(i=>i.value)),['','low','high']);
  await effort.selectOption('high');
  await translationModel.selectOption('demo-astra');
  assert.equal(await effort.inputValue(),'');
  assert.equal(await effort.locator('option[value=high]').count(),0);
  await translationModel.selectOption('test-translation');
  await effort.selectOption('high');
  assert.equal(await select.inputValue(),'demo-astra');
  assert.equal(await chatEffort.inputValue(),'medium');
  await view.locator('#start-translation').click();
  await view.locator('#progress-number').filter({hasText:'test-translation · 高'}).waitFor();
  assert.deepEqual(translationRequest,{id:sessionId,model:'test-translation',effort:'high'});
  assert.deepEqual(pageErrors,[]);
  console.log('Passed: reader, dual highlights, history, chat activity and model/effort, Save As, and independent translation settings.');
} finally {
  await browser?.close();
  host.close();
  setTimeout(()=>process.exit(process.exitCode || 0),100).unref();
}
