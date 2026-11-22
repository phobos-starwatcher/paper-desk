// Exercise both discovery paths with a missing executable from a previous Store release.
import assert from 'node:assert/strict';
import { dirname,join,win32 } from 'node:path';
import { findCodex } from '../marketplace/plugins/paper-desk/codex_executable.mjs';

const current=await findCodex('');
if(process.platform!=='win32'||!/[\\/]WindowsApps[\\/]OpenAI\.Codex_/i.test(current))
  throw new Error('This regression test requires the Windows Store version of Codex.');
const stale=join(win32.parse(current).root,'Program Files','WindowsApps',
  'OpenAI.Codex_0.0.0.0_x64__2p2nqsd0c76g0','app','resources','codex.exe');
const withPath={...process.env,PATH:dirname(current)};
assert.equal(await findCodex(stale,withPath),current);
const withoutPath=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'));
assert.equal((await findCodex(stale,withoutPath)).toLowerCase(),current.toLowerCase());
console.log('Passed: a removed Store executable is replaced by the live Codex path, with or without PATH.');
