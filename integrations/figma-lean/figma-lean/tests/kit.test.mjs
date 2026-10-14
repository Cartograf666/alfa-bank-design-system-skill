import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../kit/kit.js', import.meta.url), 'utf8');
function fixture() {
  let serial = 1, creates = 0;
  const nodes = new Map();
  function node(type, name, parent, extra = {}) {
    const n = { id: '1:' + serial++, type, name, parent: null, visible: true, width: 100, height: 100, x: 0, y: 0, children: [], fills: [], strokes: [], layoutMode: 'NONE', absoluteBoundingBox: {x:0,y:0,width:100,height:100},
      appendChild(c) { if(c.parent) c.parent.children = c.parent.children.filter(v=>v!==c); this.children.push(c); c.parent=this; },
      insertChild(i,c) { this.appendChild(c); this.children.splice(this.children.indexOf(c),1); this.children.splice(i,0,c); },
      findAllWithCriteria({types}) { const all=[]; const walk=p=>{for(const c of p.children){if(types.includes(c.type))all.push(c);walk(c)}};walk(this);return all; },
      setBoundVariable() {}, ...extra };
    nodes.set(n.id,n); if(parent)parent.appendChild(n); return n;
  }
  const root=node('DOCUMENT','file'), page=node('PAGE','page',root), frame=node('FRAME','allowed',page);
  const figma={root,currentPage:page,mixed:Symbol('mixed'), getNodeByIdAsync:async id=>nodes.get(id),setCurrentPageAsync:async p=>{figma.currentPage=p},loadFontAsync:async()=>{},
    variables:{getLocalVariablesAsync:async()=>[],getLocalVariableCollectionsAsync:async()=>[],setBoundVariableForPaint:(p,field,v)=>({...p,boundVariables:{[field]:{type:'VARIABLE_ALIAS',id:v.id}}})},
    importComponentByKeyAsync:async()=>{throw Error('stale key')},importComponentSetByKeyAsync:async()=>{throw Error('stale set')},getLocalPaintStylesAsync:async()=>[],getLocalTextStylesAsync:async()=>[],getLocalEffectStylesAsync:async()=>[]};
  const fx=vm.runInNewContext(source+';fx',{figma});
  const component=node('COMPONENT','Button',page,{createInstance(){creates++;return node('INSTANCE','Button instance',page)}});
  return {fx,figma,node,page,frame,component,get creates(){return creates}};
}
test('scope blocks implicit instance insertion before any instance is created',async()=>{const f=fixture();f.fx.__scope=[f.frame.id];await assert.rejects(f.fx.inst(f.component),/outside the allowed scope/);assert.equal(f.creates,0);const i=await f.fx.inst(f.component,f.frame);assert.equal(i.parent,f.frame)});
test('paint binding preserves images and strokes, rejects ambiguous and nonsolid inputs',async()=>{
  const {fx,node,frame}=fixture(), v={id:'v'}, image={type:'IMAGE',imageHash:'keep'}, solid={type:'SOLID',color:{r:1,g:0,b:0},opacity:.4};
  const n=node('RECTANGLE','paint',frame,{fills:[image,solid],strokes:[solid,image]});
  await fx.bind(n,{fill:v,stroke:v});assert.equal(n.fills[0],image);assert.equal(n.strokes[1],image);assert.equal(n.fills[1].opacity,.4);
  n.fills=[solid,solid];await assert.rejects(fx.bind(n,{fill:v}),/select an existing SOLID/);assert.equal(n.fills.length,2);
  await fx.bind(n,{fill:{variable:v,index:1}});assert.equal(n.fills[0],solid);assert.equal(n.fills[1].boundVariables.color.id,'v');
  n.fills=[image];await assert.rejects(fx.bind(n,{fill:v}),/preserved/);assert.equal(n.fills[0],image);
  n.fills=[];await fx.bind(n,{fill:v});assert.equal(n.fills.length,1);
});
test('done checks text parent overflow and reports QA limits without all-OK',async()=>{
  const {fx,node,frame}=fixture();const t=node('TEXT','label',frame,{characters:'old',fontName:{family:'Inter',style:'Regular'},getStyledTextSegments:()=>[],absoluteBoundingBox:{x:0,y:0,width:150,height:10}});
  await fx.text(t,'new');const report=await fx.done();assert.match(report,/overflowed.*50px/);assert.match(report,/heuristic/);assert.match(report,/visual appearance unverified/);assert.doesNotMatch(report,/— OK/);
});
test('done bounds huge tracking lists and explicitly identifies unchecked containers',async()=>{
  const {fx,node,page}=fixture();for(let i=0;i<1000;i++)fx.track(node('FRAME','n',page));const report=await fx.done();assert.match(report,/created: 1000/);assert.match(report,/NOT CHECKED/);assert.ok(Buffer.byteLength(report)<20480);
});
test('oversized single item and metadata fragment losslessly within transport limit',async()=>{
  const {fx,figma}=fixture();figma.root.name='name😀"\\'.repeat(4000);figma.variables.getLocalVariablesAsync=async()=>[{name:'var\\"😀'.repeat(5000),key:'k',id:'v',resolvedType:'COLOR'}];
  const first=await fx.scan(), parts=[];assert.equal(first.__fx,'fragment');
  for(let part=1;part<=first.parts;part++){const p=await fx.scan(undefined,{part});assert.equal(p.snapshot,first.snapshot);assert.ok(Buffer.byteLength(JSON.stringify(p))<20480);parts.push(p.fragment.data)}
  const full=JSON.parse(parts.join(''));assert.equal(full.file,figma.root.name);assert.equal(full.items[0][1][0],'var\\"😀'.repeat(5000));
});
test('component import tries next candidate and falls back to existing instance main',async()=>{
  const {fx,figma,node,page,component}=fixture();fx.__ds.c.button={k:'bad',set:1,alt:[{k:'good',set:0}]};figma.importComponentByKeyAsync=async k=>{if(k==='good')return component;throw Error('stale')};assert.equal(await fx.comp('Button'),component);
  fx.__ds.c.library={k:'bad',set:1};const main={type:'COMPONENT',name:'Library',key:'bad',parent:null};node('INSTANCE','existing',page,{getMainComponentAsync:async()=>main});assert.equal(await fx.comp('Library'),main);
});
test('clone restores component property aliases when supported and retains warnings on failure',async()=>{
  const {fx,node,frame}=fixture(), alias={type:'VARIABLE_ALIAS',id:'token'};let restored;
  const src=node('INSTANCE','source',frame,{componentProperties:{State:{type:'VARIANT',value:'on',boundVariables:{value:alias}}},clone:()=>node('INSTANCE','copy',frame,{setProperties:p=>{restored=p}})});
  await fx.clone(src,frame);assert.equal(restored.State,alias);
  src.clone=()=>node('INSTANCE','copy',frame,{setProperties:()=>{throw Error('unsupported')}});await fx.clone(src,frame);assert.match(await fx.done(),/bindings could not be restored/);
});
test('clone restores variant child componentPropertyReferences by relative child path',async()=>{
  const {fx,node,frame}=fixture();let copied;
  const src=node('COMPONENT','variant',frame), label=node('TEXT','label',src,{componentPropertyReferences:{characters:'Title#1'}});
  src.clone=()=>{const c=node('COMPONENT','copy',frame);copied=node('TEXT','label',c);return c};await fx.clone(src,frame);assert.equal(copied.componentPropertyReferences.characters,label.componentPropertyReferences.characters);
});
test('done omits descendant and instance-internal ids from compact summary',async()=>{
  const {fx,node,page}=fixture(), frame=node('FRAME','top',page), child=node('TEXT','nested',frame), internal=node('TEXT','internal',frame,{id:'I123;456'});fx.track(frame);fx.track(child);fx.track(internal);const report=await fx.done();assert.match(report,/created: 3/);const head=report.split('\n')[0];assert.ok(head.includes(frame.id));assert.ok(!head.includes(child.id));assert.ok(!head.includes(internal.id));
});
test('failed import telemetry only records unusable keys and keeps successful component fallback clean',async()=>{
  const {fx,figma,component}=fixture();fx.__ds.c.button={k:'bad',set:1,alt:[{k:'good',set:0}]};figma.importComponentByKeyAsync=async k=>{if(k==='good')return component;throw Error('bad')};await fx.comp('Button');assert.equal(fx.__failures.length,1);assert.equal(fx.__failures[0].key,'bad');
});
