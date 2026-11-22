import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const run=promisify(execFile);
const windows=process.platform==='win32';
const executable=windows?'codex.exe':'codex';
const storePath=/[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]resources[\\/]codex\.exe$/i;
const storeAlias=/[\\/]Microsoft[\\/]WindowsApps(?:[\\/]|$)/i;
let discovered;

async function usable(path) {
  if(typeof path!=='string'||!isAbsolute(path))return false;
  try{
    if(!(await stat(path)).isFile())return false;
    await access(path,constants.X_OK);
    return true;
  }catch{return false;}
}

async function registeredCodex(env) {
  const powershell=join(env.SystemRoot||env.SYSTEMROOT||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const command="$p=Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop | Where-Object InstallLocation | Sort-Object Version -Descending | Select-Object -First 1; if($p){ [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p.InstallLocation }";
  try{
    const {stdout}=await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
      {env,encoding:'utf8',windowsHide:true,timeout:4500,maxBuffer:32*1024});
    const location=stdout.trim();
    if(!isAbsolute(location)||/[\r\n]/.test(location))return null;
    const path=join(location,'app','resources','codex.exe');
    return storePath.test(path)&&await usable(path)?path:null;
  }catch{return null;}
}

export async function findCodex(configured=process.env.PAPER_DESK_CODEX,env=process.env) {
  // Honor a deliberate standalone CLI path. A versioned Store path from an older
  // install is only a fallback: Windows can remove the old bundle during updates.
  if(configured&&!storePath.test(configured)&&!(windows&&storeAlias.test(configured))&&await usable(configured))return configured;
  const pathValue=env.PATH||env.Path||'';
  for(const entry of pathValue.split(delimiter)){
    const folder=entry.trim().replace(/^"|"$/g,'');
    if(!isAbsolute(folder)||(windows&&storeAlias.test(folder)))continue;
    const path=join(folder,executable);
    if(await usable(path))return path;
  }
  if(windows){
    if(discovered?.env===env&&await usable(discovered.path))return discovered.path;
    const path=await registeredCodex(env);
    if(path){discovered={env,path};return path;}
  }
  if(configured&&!(windows&&storeAlias.test(configured))&&await usable(configured))return configured;
  throw new Error('找不到可用的 Codex 程序。请确认 Codex 桌面版已安装并能正常打开。');
}
