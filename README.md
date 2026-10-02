# Memória Ativa — versão para celular

Esta versão usa HTML no navegador + funções serverless. A chave da OpenAI fica no servidor e não é colocada no celular nem no código público.

## Estrutura
- `index.html` — aplicativo
- `api/generate.js` — geração por IA em 3 etapas
- `api/health.js` — teste do servidor
- `vercel.json` — configuração

## Publicação
1. Crie uma conta na Vercel.
2. Importe este projeto ou envie a pasta como um novo projeto.
3. Em Environment Variables, crie `OPENAI_API_KEY` com sua chave.
4. Opcional: defina `OPENAI_MODEL` e `OPENAI_REVIEW_MODEL` se quiser usar outros modelos disponíveis na sua conta.
5. Faça o deploy.
6. Abra a URL gerada no celular.

## Teste
Abra `/api/health`. Deve aparecer JSON com `ok: true`. Depois use o gerador dentro do app.

IMPORTANTE: nunca coloque `OPENAI_API_KEY` dentro de `index.html`.
