import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const statement='Every tree in this synthetic example has a root node.';
function fixture(legacy=false){
 const visible={getClientRects:()=>[{}]};
 const root={...visible,tagName:'DIV',id:'item',className:'questionWrapper'};
 const prompt={...visible,tagName:'P',id:'statement',className:legacy?'problemTypes':'',innerText:statement,parentElement:root,contains:()=>false};
 const labels=['a. True','b. False'].map(innerText=>({...visible,innerText,parentElement:root}));
 const inputs=labels.map((label,i)=>({...visible,tagName:'INPUT',id:'choice'+i,name:'answer',labels:[label],parentElement:root,getAttribute:()=>null}));
 root.contains=el=>el===prompt||labels.includes(el)||inputs.includes(el);
 root.querySelectorAll=selector=>selector==='.problemTypes'?(legacy?[prompt]:[]):selector==='audio'?[]:selector.includes('input')?inputs:[prompt];
 const document={baseURI:'https://media.example.test/ilrn/takeAssignment/test',querySelectorAll:()=>[root],defaultView:{getComputedStyle:()=>({visibility:'visible'})}};
 const scope=vm.createContext({URL,document});vm.runInContext(fs.readFileSync(new URL('../content/parser.js',import.meta.url),'utf8'),scope);
 return scope.qaReadQuestion();
}
test('failed prompt diagnostics report exact statement, options and structural relationships without accepting a fallback',()=>{
 const result=fixture();assert.equal(result.ok,false);assert.equal(result.reason,'Question prompt is ambiguous or missing');
 const debug=result.parserDiagnostics;assert.equal(debug.diagnosticsVersion,'prompt-inspection-1');assert.equal(debug.optionCount,2);assert.equal(debug.parsedQuestion,null);
 assert.deepEqual(Array.from(debug.options,item=>item.labels[0].text),['a. True','b. False']);
 assert.equal(debug.promptCandidates[0].text,statement);assert.match(debug.promptCandidates[0].reason,/not a verified prompt association/);
 assert.equal(debug.promptCandidates[0].relation.commonAncestorsWithRadios[0].id,'item');
});
test('existing recognized declarative prompt still works and diagnostics stay outside request data',()=>{
 const result=fixture(true);assert.equal(result.ok,true);assert.equal(result.data.question,statement);
 assert.deepEqual(Array.from(result.data.choices,c=>c.text),['True','False']);assert.equal(result.parserDiagnostics.parsedQuestion.question,statement);
 assert.equal(result.data.parserDiagnostics,undefined);assert.equal(result.data.promptCandidates,undefined);
});
