// Live smoke test, with a single synthetic-paper question to a nondefault model.
import assert from 'node:assert/strict';
import { handle } from '../marketplace/plugins/paper-desk/server.mjs';
import { codexArgs } from '../marketplace/plugins/paper-desk/codex_model.mjs';

const rpc=(method,params)=>handle({method,params});
const tools=(await rpc('tools/list')).tools;
const sidebar=tools.find(tool=>tool.name==='reader_panel');
assert.ok(sidebar._meta['openai/ui'].entrypoints.some(e=>e.type==='global'));
assert.match(sidebar.icons[0].src,/^data:image\/png;base64,/);
const header=Buffer.from(sidebar.icons[0].src.split(',')[1],'base64');
assert.equal(header.readUInt32BE(16),128);
assert.equal(header.readUInt32BE(20),128);
const session=(await rpc('tools/call',{name:'open_paper',arguments:{demo:true}})).structuredContent;
assert.equal(session.chatModel,'');
const call=(action,args={},name='reader_action')=>rpc('tools/call',{name,arguments:{action,args:{id:session.id,...args}}});
const catalog=(await call('models',{},'reader_read'))._meta.data;
const candidate=catalog.models.find(m=>m.id==='gpt-6.2-astra'&&m.id!==catalog.defaultModel)||
  catalog.models.find(m=>m.id!==catalog.defaultModel);
assert.ok(candidate,'Codex model list should include a nondefault model');
const args=codexArgs([],candidate);
assert.equal(args[args.indexOf('--model')+1],candidate.id);
assert.ok(!codexArgs([],null).includes('--model'));
assert.ok((await call('setChatModel',{model:'no-such-paper-desk-model'})).isError);
const selected=await call('setChatModel',{model:candidate.id});
assert.equal(selected._meta.data.chatModel,candidate.id);
const reply=await call('ask',{page:0,question:'示例论文里，M78 目标区的脉冲检出率是多少？回答一行。'});
assert.ok(!reply.isError,reply.content[0].text);
const answer=reply._meta.data.chat.at(-1);
assert.equal(answer.model,candidate.id);
assert.match(answer.content,/80\s*[%％]/);
assert.equal((await call('setChatModel',{model:''}))._meta.data.chatModel,'');
console.log('Passed: actual Codex catalog, explicit '+candidate.id+' reply, reset to default, and a packaged MCP sidebar icon.');
