import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'tools','codex-bridge.js'),'utf8');
const AsyncFunction=(async()=>{}).constructor;
const setup=(remote,failIngest=false)=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'figma-lean-bridge-test-'));
  let calls=0;const commands=[];
  const tools={exec_command:async({cmd})=>{
    commands.push(cmd);
    if(failIngest && /\bingest(?:\s|$)/.test(cmd)) return {exit_code:1,output:'fixture ingest failure'};
    const r=spawnSync(cmd,{shell:'/bin/sh',encoding:'utf8',maxBuffer:8*1024*1024});
    return {exit_code:r.status,output:r.stdout+r.stderr};
  },mcp__codex_apps__figma_use_figma:async(args)=>{calls++;return remote(args);},mcp__codex_apps__figma_search_design_system:async(args)=>{calls++;return remote(args);}};
  const lean=new Function('tools',source+';return figmaLean;')(tools);
  return {home,commands,call:args=>lean({fileKey:'TestFileKey',description:'Fixture',cli:path.join(root,'tools','fx.mjs'),dataHome:home,...args}),count:()=>calls,close:()=>fs.rmSync(home,{recursive:true,force:true})};
};
test('Codex bridge compiles fx code, executes one tool call and retains media',async()=>{
  const image={type:'image',mimeType:'image/png',data:'MEDIA_BLOB_SENTINEL'};
  const h=setup(async(args)=>{
    assert.ok(args.code.includes('const fx'));
    const frame={id:'1:1',name:'Requested frame',type:'FRAME',parent:{type:'PAGE',id:'0:1'}};
    const figma={getNodeByIdAsync:async()=>frame,setCurrentPageAsync:async()=>{},mixed:Symbol()};
    const value=await new AsyncFunction('figma',args.code)(figma);
    return {content:[{type:'text',text:JSON.stringify(value)},image]};
  });
  try {
    const result=await h.call({code:"return await fx.get('1:1','name')"});
    assert.equal(h.count(),1);assert.deepEqual(result.content[1],image);
    assert.equal(JSON.parse(result.content[0].text).name,'Requested frame');
    assert.ok(h.commands.every(c=>!c.includes('MEDIA_BLOB_SENTINEL')));
  }finally{h.close();}
});
test('Codex bridge shell input preserves quotes, dollar expressions and backticks literally',async()=>{
  const marker=path.join(os.tmpdir(),'figma-lean-no-shell-execution-'+process.pid);
  const literal="O'Reilly $(touch "+marker+") `touch "+marker+"` \\ Привет 🙂";
  const h=setup(async args=>({content:[{type:'text',text:await new AsyncFunction(args.code)()}]}));
  try {const result=await h.call({code:'return '+JSON.stringify(literal)});assert.equal(result.content[0].text,literal);assert.equal(fs.existsSync(marker),false);}finally{h.close();}
});
test('bad syntax blocks before Figma and ingest failure never repeats the write',async()=>{
  const h=setup(async()=>({content:[{type:'text',text:'remote write completed'}]}),true);
  try {
    await assert.rejects(h.call({code:'return fx.get(('}));assert.equal(h.count(),0);
    const result=await h.call({code:'return 1'});assert.equal(h.count(),1);
    assert.equal(result.content[0].text,'remote write completed');assert.match(result.content[1].text,/original Figma result preserved/);
  }finally{h.close();}
});
test('large Unicode search result is spooled and all keys are cached',async()=>{
  const components=Array.from({length:160},(_,i)=>({name:'Компонент🙂 '+i,componentKey:i.toString(16).padStart(40,'0'),libraryName:'Fixture',description:'Ж🙂'.repeat(400)}));
  const h=setup(async()=>({content:[{type:'text',text:JSON.stringify({results:[{entity:'component',query:'Компонент',components}]})}]}));
  try {
    const result=await h.call({operation:'search_design_system',args:{queries:[]}});
    const ds=JSON.parse(fs.readFileSync(path.join(h.home,'ds','registry.json'),'utf8'));
    assert.equal(Object.keys(ds.components).length,160);assert.ok(Object.values(ds.components).every(c=>c.n.includes('🙂')));
    assert.ok(result.content[0].text.length<10000);assert.ok(h.commands.every(c=>c.length<150000));assert.equal(h.count(),1);
  }finally{h.close();}
});
test('structured write returns keep every ID on disk while model report stays compact',async()=>{
  const expected={createdIds:Array.from({length:200},(_,i)=>'1:'+i),changedIds:['I1:9;2:8','1:400'],qa:'heuristic QA fixture'};
  const h=setup(async()=>({content:[{type:'text',text:JSON.stringify(expected)}]}));
  try {
    const result=await h.call({code:'return '+JSON.stringify(expected)});
    const shown=JSON.parse(result.content[0].text);
    assert.equal(shown.writes.created,200);assert.equal(shown.writes.changed,2);
    assert.deepEqual(JSON.parse(fs.readFileSync(shown.writes.idsFile,'utf8')),expected);
    assert.ok(result.content[0].text.length<500);assert.equal(h.count(),1);
  }finally{h.close();}
});
