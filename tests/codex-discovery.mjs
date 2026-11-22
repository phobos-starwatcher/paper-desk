import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const exe = process.env.PAPER_DESK_CODEX_EXE ||
  execFileSync('where.exe', ['codex.exe'], { encoding:'utf8' }).trim().split(/\r?\n/)[0];
const child=spawn(exe,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let next=1;
const pending=new Map();
createInterface({input:child.stdout}).on('line',line=>{
  try{
    const msg=JSON.parse(line), call=pending.get(msg.id);
    if(!call)return;
    pending.delete(msg.id);
    if(msg.error)call.reject(Error(msg.error.message));else call.resolve(msg.result);
  }catch{}
});
createInterface({input:child.stderr}).on('line',line=>{
  if(/paper.desk|MODULE_NOT_FOUND/.test(line))process.stderr.write(line+'\n');
});
function request(method,params){
  return new Promise((resolve,reject)=>{
    const id=next++;
    pending.set(id,{resolve,reject});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
const timeout=setTimeout(()=>{child.kill();console.error('Codex backend response timed out.');process.exit(1);},36000);
try {
  await request('initialize',{clientInfo:{name:'paper_desk_check',version:'1.0.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const r=await request('mcpServerStatus/list',{cursor:null,limit:100,serverName:'paper_desk'});
  const result=r.data?.find(x=>x.name.includes('paper_desk'));
  assert.ok(result, 'Codex backend did not discover paper_desk');
  assert.ok(!result.toolsError, JSON.stringify(result.toolsError));
  assert.ok(Object.values(result.tools).some(t=>t.name==='open_paper'));
  assert.ok(result.resources.some(resource=>resource.uri==='ui://paper-desk/reader.html'));
  console.log('Codex app-server discovered '+result.name+' with '+Object.keys(result.tools).length+' tools and the MCP reader UI.');
} finally {clearTimeout(timeout);child.kill();}
