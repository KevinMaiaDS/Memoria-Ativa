module.exports = async function handler(req,res){
  res.statusCode=200;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({
    ok:true,
    configured:Boolean(process.env.GEMINI_API_KEY),
    provider:'google-gemini',
    model:process.env.GEMINI_MODEL||'gemini-3.8-flash',
    architecture:'facts -> questions -> audit'
  }));
};
