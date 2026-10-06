// Memória Ativa — Vercel serverless backend
// A chave OPENAI_API_KEY fica SOMENTE no servidor. Nunca coloque a chave no HTML.
const MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
const REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || MODEL;
const API_KEY = process.env.OPENAI_API_KEY;

const factSchema = {
  type:'object', additionalProperties:false,
  properties:{
    facts:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      id:{type:'string'}, subject:{type:'string'}, relation:{type:'string'}, object:{type:'string'},
      qualifiers:{type:'string'}, source:{type:'string'}, importance:{type:'string',enum:['alta','media','baixa']}
    },required:['id','subject','relation','object','qualifiers','source','importance']}}
  }, required:['facts']
};

const questionSchema = {
  type:'object', additionalProperties:false,
  properties:{
    questions:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      question:{type:'string'}, answer:{type:'string'}, type:{type:'string'},
      fact_id:{type:'string'}, source:{type:'string'}
    },required:['question','answer','type','fact_id','source']}}
  }, required:['questions']
};

const reviewSchema = {
  type:'object', additionalProperties:false,
  properties:{
    questions:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      question:{type:'string'}, answer:{type:'string'}, type:{type:'string'}, fact_id:{type:'string'}, source:{type:'string'}, keep:{type:'boolean'}
    },required:['question','answer','type','fact_id','source','keep']}}
  }, required:['questions']
};

const extractPrompt = `Você é o extrator semântico do aplicativo Memória Ativa.
Leia SOMENTE o material fornecido e decomponha-o em fatos atômicos úteis para estudo.

Um fato atômico deve representar uma informação que possa ser recuperada independentemente: definição, entidade, data, local, causa, consequência, função, processo, transformação, característica, finalidade, relação, quantidade ou sequência.

REGRAS:
- Não acrescente conhecimento externo.
- Não invente relações implícitas.
- Se uma frase contém várias informações independentes, separe-as em fatos diferentes.
- Não transforme cada frase automaticamente em um fato: extraia apenas conteúdo informativo.
- subject deve ser a entidade/conceito sobre o qual o fato fala.
- relation deve ser uma relação curta e objetiva.
- object deve conter somente a informação relacionada.
- qualifiers deve conter circunstâncias necessárias, como data, local, condição ou contexto, sem duplicar object.
- source deve ser um trecho curto ou paráfrase fiel que permita auditar o fato no material.
- importance deve refletir relevância para aprendizagem, não frequência de palavras.
- Evite fatos redundantes.`;

const generatePrompt = `Você é o gerador de perguntas de recuperação ativa do aplicativo Memória Ativa.
Receberá fatos atômicos extraídos de um material. Gere perguntas usando SOMENTE esses fatos e o material original.

REGRAS:
1. Cada pergunta deve testar UMA informação específica.
2. A resposta deve responder exatamente à pergunta.
3. Nunca use "Segundo o material, qual informação...", "o que o texto apresenta..." ou equivalentes.
4. Não repita o mesmo fato com pequenas mudanças de redação.
5. Uma pergunta diferente só é válida se recuperar uma dimensão diferente do fato: quem/o quê, quando, onde, causa, consequência, função, finalidade, processo, característica, relação etc.
6. Não crie uma dimensão que o fato não sustente.
7. Não invente comparação, causalidade ou finalidade.
8. Prefira perguntas naturais em português brasileiro.
9. O aluno deve conseguir responder pela memória depois de estudar o material; não faça perguntas que sejam apenas cópia da estrutura da frase.
10. source deve sustentar diretamente a pergunta e a resposta.
11. Priorize fatos de importância alta e média; não force a quantidade máxima.
12. Não use conhecimento externo, mesmo que você conheça o assunto.`;

const reviewPrompt = `Você é o auditor final de perguntas de recuperação ativa.
Receberá o material original e perguntas candidatas.
Para cada candidata, mantenha somente se TODAS as condições forem verdadeiras:
- a resposta é sustentada pelo material;
- a pergunta pede exatamente a informação respondida;
- a pergunta é natural em português brasileiro;
- não é genérica nem depende de "segundo o material";
- não é redundante com outra candidata que testa o mesmo fato e a mesma dimensão;
- exige recuperação de uma informação real, não mera cópia vazia.

Se houver um problema pequeno de redação, corrija a pergunta/resposta sem adicionar informação.
Se houver problema de conteúdo, marque keep=false.
Não acrescente conhecimento externo.`;

function send(res,status,obj,type='application/json; charset=utf-8') {
  res.writeHead(status,{'Content-Type':type,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
  res.end(type.startsWith('application/json') ? JSON.stringify(obj) : obj);
}
function parseBody(req){
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>{body+=chunk;if(body.length>4_000_000){req.destroy();reject(new Error('Material muito grande.'));}});
    req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(new Error('JSON inválido.'));}});
    req.on('error',reject);
  });
}
function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
function genericBad(q){
  const n=norm(q);
  return !q || q.length<12 || /segundo o material|qual informacao.*apresentad|o que o texto apresenta|qual informacao o texto/i.test(n) || /^o que aconteceu\??$/i.test(q.trim()) || /\b(qual informacao|que informacao)\b/.test(n) && n.length<55;
}
function overlap(a,b){
  const A=new Set(norm(a).split(' ').filter(x=>x.length>3));
  const B=new Set(norm(b).split(' ').filter(x=>x.length>3));
  if(!A.size||!B.size)return 0;
  let hit=0;for(const x of A)if(B.has(x))hit++;
  return hit/Math.max(1,Math.min(A.size,B.size));
}

async function callOpenAI(model,input,textSchema){
  if(!API_KEY) throw new Error('OPENAI_API_KEY não configurada no servidor.');
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${API_KEY}`},body:JSON.stringify({
    model,
    input,
    text:{format:{type:'json_schema',name:textSchema.name,strict:true,schema:textSchema.schema}}
  })});
  const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||`OpenAI respondeu ${r.status}`);
  let raw='';
  for(const item of(data.output||[]))for(const c of(item.content||[]))if(c.type==='output_text'&&c.text)raw+=c.text;
  if(!raw)throw new Error('A API não retornou conteúdo estruturado.');
  try{return JSON.parse(raw);}catch{throw new Error('A resposta estruturada não pôde ser interpretada.');}
}

async function generate(body){
  const text=String(body.text||'').trim();
  const limit=Math.min(50,Math.max(1,Number(body.limit)||20));
  const category=String(body.category||'').trim();
  if(!text)throw new Error('Material vazio.');

  const factsOut=await callOpenAI(MODEL,[
    {role:'system',content:[{type:'input_text',text:extractPrompt}]},
    {role:'user',content:[{type:'input_text',text:`Categoria: ${category||'não informada'}\n\nMATERIAL ORIGINAL:\n${text}`}]}
  ],{name:'memoria_ativa_facts',schema:factSchema});
  const facts=(factsOut.facts||[]).filter(f=>f&&f.subject&&f.relation&&f.object&&f.source).slice(0,120);
  if(!facts.length)throw new Error('Não foi possível extrair fatos estudáveis do material.');

  const genOut=await callOpenAI(MODEL,[
    {role:'system',content:[{type:'input_text',text:generatePrompt}]},
    {role:'user',content:[{type:'input_text',text:`MATERIAL ORIGINAL:\n${text}\n\nFATOS EXTRAÍDOS:\n${JSON.stringify(facts)}\n\nGere no máximo ${limit} perguntas. Escolha as recuperações mais úteis e não repita fatos.`}]}
  ],{name:'memoria_ativa_questions',schema:questionSchema});
  let candidates=(genOut.questions||[]).filter(x=>x&&x.question&&x.answer&&x.fact_id&&x.source).slice(0,Math.max(limit*2,limit));

  // Filtro determinístico barato antes do auditor.
  const seenQ=new Set(), seenFactDim=new Set();
  candidates=candidates.filter(x=>{
    x.question=String(x.question).trim();x.answer=String(x.answer).trim();
    if(genericBad(x.question))return false;
    const qk=norm(x.question), fk=norm(x.fact_id)+'|'+norm(x.type);
    if(seenQ.has(qk)||seenFactDim.has(fk))return false;
    seenQ.add(qk);seenFactDim.add(fk);return true;
  });
  if(!candidates.length)throw new Error('A geração não produziu perguntas suficientemente específicas.');

  const reviewOut=await callOpenAI(REVIEW_MODEL,[
    {role:'system',content:[{type:'input_text',text:reviewPrompt}]},
    {role:'user',content:[{type:'input_text',text:`MATERIAL ORIGINAL:\n${text}\n\nPERGUNTAS CANDIDATAS:\n${JSON.stringify(candidates)}`}]}
  ],{name:'memoria_ativa_review',schema:reviewSchema});

  const factsById=new Map(facts.map(f=>[f.id,f]));
  const final=[];const finalQ=new Set();
  for(const x of(reviewOut.questions||[])){
    if(!x.keep||!x.question||!x.answer)continue;
    const q=String(x.question).trim(),a=String(x.answer).trim();
    if(genericBad(q))continue;
    const key=norm(q);
    if(finalQ.has(key))continue;
    // Exige alguma ancoragem lexical na fonte retornada pela auditoria/fato.
    const fact=factsById.get(x.fact_id);
    const src=String(x.source||fact?.source||'').trim();
    if(!src)continue;
    if(overlap(a,src)<0.12 && overlap(q,src)<0.08)continue;
    finalQ.add(key);final.push({question:q,answer:a,type:String(x.type||''),fact_id:String(x.fact_id||''),source:src});
    if(final.length>=limit)break;
  }
  return {questions:final,factsExtracted:facts.length,model:MODEL,reviewModel:REVIEW_MODEL,passes:3};
}



module.exports = async function handler(req,res){
  if(req.method==='OPTIONS'){
    res.statusCode=204;
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    return res.end();
  }
  if(req.method!=='POST'){
    res.statusCode=405;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Método não permitido.'}));
  }
  try{
    const body=typeof req.body==='object' && req.body ? req.body : {};
    const result=await generate(body);
    res.statusCode=200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    return res.end(JSON.stringify(result));
  }catch(e){
    res.statusCode=400;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    return res.end(JSON.stringify({error:e.message||String(e)}));
  }
};
