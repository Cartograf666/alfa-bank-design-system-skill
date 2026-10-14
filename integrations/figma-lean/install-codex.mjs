#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const target = path.join(codexHome, 'skills', 'figma-lean');
const data = process.env.FIGMA_LEAN_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'figma-lean');
fs.mkdirSync(codexHome,{recursive:true});
const staging=fs.mkdtempSync(path.join(codexHome,'.figma-lean-install-'));
let backup=null;
try {
  for (const dir of ['kit','tools','references','tests']) fs.cpSync(path.join(root,'figma-lean',dir), path.join(staging,dir), {recursive: true});
  fs.cpSync(path.join(root,'recipes'),path.join(staging,'recipes'),{recursive:true});
  const skill = fs.readFileSync(path.join(root,'codex','SKILL.md'),'utf8').replaceAll('__SKILL_ROOT__',target).replaceAll('__DATA_HOME__',data);
  fs.writeFileSync(path.join(staging,'SKILL.md'),skill);
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing to replace a symlinked skill; choose a normal CODEX_HOME directory.');
    const backups=path.join(codexHome,'backups');fs.mkdirSync(backups,{recursive:true});
    backup=path.join(fs.mkdtempSync(path.join(backups,'figma-lean-')),'skill');
    fs.renameSync(target,backup);
    console.log('Previous skill backed up outside discovery: ' + backup);
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});
  try {fs.renameSync(staging,target);} catch(error) {if(backup) fs.renameSync(backup,target);throw error;}
} finally {if(fs.existsSync(staging)) fs.rmSync(staging,{recursive:true,force:true});}
fs.mkdirSync(path.join(data,'recipes'),{recursive:true});
for (const name of ['cprops.js','texts.js']) {
  const destination = path.join(data,'recipes',name);
  if (fs.existsSync(destination)) fs.copyFileSync(destination,destination+'.backup-'+Date.now());
  fs.copyFileSync(path.join(root,'recipes',name),destination);
}
console.log('Installed: ' + target);
console.log('Data: ' + data);
console.log('No hooks, permissions, plugin files or config.toml were changed. Start a new chat if skill discovery has not refreshed.');
