// Memória Ativa — Vercel serverless backend
// Provedor atual: Google Gemini API. A chave GEMINI_API_KEY fica SOMENTE no servidor.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const factSchema = {
  type:'object',
  properties:{
    facts:{type:'array',items:{type:'object',properties:{
      id:{type:'string'}, subject:{type:'string'}, relation:{type:'string'}, object:{type:'string'},
      qualifiers:{type:'string'}, source:{type:'string'}, importance:{type:'string',enum:['alta','media','baixa']}
    },required:['id','subject','relation','object','qualifiers','source','importance']}}
  },
  required:['facts']
};

const questionSchema = {
  type:'object',
  properties:{
    questions:{type:'array',items:{type:'object',properties:{
      question:{type:'string'}, answer:{type:'string'}, type:{type:'string'},
      fact_id:{type:'string'}, source:{type:'string'}
    },required:['question','answer','type','fact_id','source']}}
  },
  required:['questions']
};

const reviewSchema = {
  type:'object',
  properties:{
    questions:{type:'array',items:{type:'object',properties:{
      question:{type:'string'}, answer:{type:'string'}, type:{type:'string'}, fact_id:{type:'string'}, source:{type:'string'}, keep:{type:'boolean'}
    },required:['question','answer','type','fact_id','source','keep']}}
  },
  required:['questions']
};

const extractPrompt = `Você é o extrator semântico do aplicativo Memória Ativa.
Leia SOMENTE o material fornecido e decomponha-o em fatos atômicos úteis para estudo.

Um fato atômico representa uma informação que possa ser recuperada independentemente: definição, entidade, data, local, causa, consequência, função, processo, transformação, característica, finalidade, relação, quantidade ou sequência.

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
8. Prefira perguntas naturais em português brasileiro, como as que um professor faria em uma prova.
9. O aluno deve conseguir responder pela memória depois de estudar o material; não faça perguntas que sejam apenas cópia vazia da estrutura da frase.
10. source deve sustentar diretamente a pergunta e a resposta.
11. Priorize fatos de importância alta e média, mas aproveite fatos de baixa importância quando acrescentarem uma recuperação realmente diferente.
12. Não use conhecimento externo.
13. Busque cobertura ampla do material. Não pare em 5–10 perguntas se houver fatos independentes suficientes para gerar mais perguntas de qualidade.
14. Gere até o limite solicitado; quantidade não deve ser obtida sacrificando qualidade.`;

const reviewPrompt = `Você é o auditor final de perguntas de recuperação ativa do aplicativo Memória Ativa.
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
Não acrescente conhecimento externo.
Preserve perguntas boas mesmo que sejam sobre detalhes diferentes do mesmo tema.`;

function parseBody(req){
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>{
      body+=chunk;
      if(body.length>4_000_000){req.destroy();reject(new Error('Material muito grande.'));}
    });
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

async function callGemini(model,systemPrompt,userPrompt,schema,maxOutputTokens=12000){
  if(!API_KEY) throw new Error('GEMINI_API_KEY não configurada na Vercel.');

  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const r=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:systemPrompt}]},
      contents:[{role:'user',parts:[{text:userPrompt}]}],
      generationConfig:{
        responseMimeType:'application/json',
        responseSchema:schema,
        temperature:0.2,
        maxOutputTokens
      }
    })
  });

  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const msg=data?.error?.message||`Gemini respondeu ${r.status}`;
    throw new Error(msg);
  }

  let raw='';
  for(const candidate of(data.candidates||[])){
    for(const part of(candidate.content?.parts||[])){
      if(part.text)raw+=part.text;
    }
  }
  if(!raw)throw new Error('A API Gemini não retornou conteúdo estruturado.');
  try{return JSON.parse(raw);}catch{throw new Error('A resposta estruturada do Gemini não pôde ser interpretada.');}
}

async function generate(body){
  const text=String(body.text||'').trim();
  const limit=Math.min(50,Math.max(1,Number(body.limit)||20));
  const category=String(body.category||'').trim();
  if(!text)throw new Error('Material vazio.');

  // 1) Extração semântica.
  const factsOut=await callGemini(MODEL,extractPrompt,
    `Categoria: ${category||'não informada'}\n\nMATERIAL ORIGINAL:\n${text}`,
    factSchema,12000);
  const facts=(factsOut.facts||[]).filter(f=>f&&f.subject&&f.relation&&f.object&&f.source).slice(0,160);
  if(!facts.length)throw new Error('Não foi possível extrair fatos estudáveis do material.');

  // 2) Geração ampla de candidatos.
  const requested=Math.min(100,Math.max(limit*2,limit+10));
  const genOut=await callGemini(MODEL,generatePrompt,
    `MATERIAL ORIGINAL:\n${text}\n\nFATOS EXTRAÍDOS:\n${JSON.stringify(facts)}\n\nGere até ${requested} perguntas candidatas. O aplicativo selecionará as melhores para entregar no máximo ${limit}.`,
    questionSchema,16000);
  let candidates=(genOut.questions||[]).filter(x=>x&&x.question&&x.answer&&x.fact_id&&x.source).slice(0,requested);

  // Filtro determinístico antes do auditor.
  const seenQ=new Set(),seenFactDim=new Set();
  candidates=candidates.filter(x=>{
    x.question=String(x.question).trim();x.answer=String(x.answer).trim();
    if(genericBad(x.question))return false;
    const qk=norm(x.question),fk=norm(x.fact_id)+'|'+norm(x.type);
    if(seenQ.has(qk)||seenFactDim.has(fk))return false;
    seenQ.add(qk);seenFactDim.add(fk);return true;
  });
  if(!candidates.length)throw new Error('A geração não produziu perguntas suficientemente específicas.');

  // 3) Auditoria semântica.
  const reviewOut=await callGemini(MODEL,reviewPrompt,
    `MATERIAL ORIGINAL:\n${text}\n\nPERGUNTAS CANDIDATAS:\n${JSON.stringify(candidates)}`,
    reviewSchema,16000);

  const factsById=new Map(facts.map(f=>[f.id,f]));
  const final=[];const finalQ=new Set();
  for(const x of(reviewOut.questions||[])){
    if(!x.keep||!x.question||!x.answer)continue;
    const q=String(x.question).trim(),a=String(x.answer).trim();
    if(genericBad(q))continue;
    const key=norm(q);
    if(finalQ.has(key))continue;
    const fact=factsById.get(x.fact_id);
    const src=String(x.source||fact?.source||'').trim();
    if(!src)continue;
    if(overlap(a,src)<0.12 && overlap(q,src)<0.08)continue;
    finalQ.add(key);
    final.push({question:q,answer:a,type:String(x.type||''),fact_id:String(x.fact_id||''),source:src});
    if(final.length>=limit)break;
  }

  if(!final.length)throw new Error('A auditoria não aprovou perguntas válidas.');
  return {questions:final,factsExtracted:facts.length,model:MODEL,provider:'google-gemini',passes:3};
}

module.exports = async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Cache-Control','no-store');

  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'Método não permitido.'});

  try{
    const body=typeof req.body==='object'&&req.body?req.body:await parseBody(req);
    const result=await generate(body);
    return res.status(200).json(result);
  }catch(e){
    return res.status(400).json({error:e.message||String(e)});
  }
};
