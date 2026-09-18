import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateQuestion,buildRequest} from '../background/openai.mjs';
const html=fs.readFileSync(new URL('./fixtures/synthetic-two-choice.html',import.meta.url),'utf8');
const statement=html.match(/class="problemTypes">([^<]+)<\/div>/)[1];
function fixture({text=statement,choices=['True','False'],refs=true,linked=true,extra=false}={}){
 const node=(tag,id='',className='',innerText='')=>({tagName:tag,id,className,innerText,children:[],getClientRects:()=>[{}],contains(el){return this.children.some(child=>child===el||child.contains?.(el));}});
 const root=node('DIV','','questionWrapper'),outer=node('TD','','problemTypes'),prompt=node('DIV','synthetic-item-001_question','problemTypes',text),answer=node('SPAN',linked?'submitForm_synthetic-item-001':'unrelated'),answerCell=node('TD','','problemTypes');
 const labels=choices.map((text,i)=>node('LABEL','','',String.fromCharCode(97+i)+'. '+text));
 const inputs=labels.map((label,i)=>({...node('INPUT','choice.synthetic-item-001_'+(i+1)),name:'choice.synthetic-item-001',labels:[label],getAttribute:key=>key==='aria-describedby'&&refs?prompt.id:null}));
 root.children=[outer];outer.children=[prompt,answer];answer.children=[answerCell];answerCell.children=[...inputs,...labels];
 const unrelated=node('P','','','Unrelated nearby instructions');root.children.push(unrelated);
 function parents(parent){for(const child of parent.children){child.parentElement=parent;parents(child);}}parents(root);
 const legacy=[outer,prompt,answerCell];if(extra){const second=node('DIV','other_question','problemTypes','Another statement');legacy.push(second);root.children.push(second);}
 const radios=()=>inputs;
 answer.querySelectorAll=radios;
 root.querySelectorAll=selector=>selector==='.problemTypes'?legacy:selector==='.choiceTable input[type="radio"]'?[]:selector==='audio'?[]:[prompt,answer,unrelated];
 const document={baseURI:'https://media.example.test/ilrn/takeAssignment/test',querySelectorAll:()=>[root],getElementById:id=>[prompt,answer].find(el=>el.id===id)||null,defaultView:{getComputedStyle:()=>({visibility:'visible'})}};
 const scope=vm.createContext({URL,document});vm.runInContext(fs.readFileSync(new URL('../content/parser.js',import.meta.url),'utf8'),scope);return scope.qaReadQuestion();
}
test('nested problemTypes + submitForm radio group parses the synthetic declarative statement',()=>{
 const result=fixture();assert.equal(result.ok,true,result.reason);assert.equal(result.data.question,statement);assert.equal(result.parserDiagnostics.optionCount,2);
 assert.deepEqual(Array.from(result.data.choices,c=>c.text),['True','False']);assert.equal(result.data.audioStatus,'none');
 const payload=JSON.parse(buildRequest(validateQuestion(result.data),'text').input);assert.equal(payload.question,statement);assert.deepEqual(payload.choices.map(c=>c.text),['True','False']);
});
test('same structural association supports declarative non-TF, interrogative and four-choice items',()=>{
 for(const config of [{choices:['First statement','Second statement']},{text:'Which node is the root?'},{choices:['one','two','three','four']}]){const result=fixture(config);assert.equal(result.ok,true,result.reason);assert.equal(result.data.choices.length,config.choices?.length||2);assert.equal(result.data.question,config.text||statement);}
});
test('unrelated radio area or missing explicit prompt link is not adopted from nearby text',()=>{
 for(const config of [{linked:false},{refs:false}]){const result=fixture(config);assert.equal(result.ok,false);assert.equal(result.parserDiagnostics.parsedQuestion,null);}
});
