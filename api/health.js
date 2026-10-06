module.exports = async function handler(req,res){
  res.statusCode=200;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify({ok:true,configured:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||'gpt-6-luna',reviewModel:process.env.OPENAI_REVIEW_MODEL||process.env.OPENAI_MODEL||'gpt-6-luna',architecture:'facts -> questions -> audit'}));
};
