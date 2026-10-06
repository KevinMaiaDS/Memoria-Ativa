# Memória Ativa — versão para celular

Esta versão usa HTML no navegador e possui dois caminhos de geração:

- **Gerador local/offline:** funciona no próprio navegador e não usa créditos da OpenAI.
- **Gerador com IA:** usa `api/generate.js` e a API da OpenAI para análise semântica. Esse modo exige `OPENAI_API_KEY` e créditos disponíveis na conta da API.

Quando o modo IA falha (por exemplo, por falta de créditos, chave ausente ou servidor indisponível), o aplicativo agora tenta automaticamente o gerador local para não interromper o estudo.

## Estrutura
- `index.html` — aplicativo
- `api/generate.js` — geração por IA em 3 etapas
- `api/health.js` — teste do servidor
- `server.js` — servidor local para executar o app no navegador
- `vercel.json` — configuração

## Executar localmente

Requer Node.js 18 ou superior.

```bash
npm start
```

Depois abra:

```text
http://localhost:3000
```

O teste do servidor fica em:

```text
http://localhost:3000/api/health
```

O servidor local permite que o endpoint `/api/generate` seja encontrado corretamente. Porém, ele **não elimina a cobrança da API da OpenAI**: o modo IA ainda precisa de uma chave e de créditos.

## Usar somente sem API

Não é necessário configurar `OPENAI_API_KEY` para estudar ou usar o gerador local. O botão **Gerar com IA** também cai automaticamente para a geração local quando a API não estiver disponível.

## Publicação na Vercel

1. Importe o projeto na Vercel.
2. Em Environment Variables, configure `OPENAI_API_KEY` se quiser usar o modo IA.
3. Opcionalmente, defina `OPENAI_MODEL` e `OPENAI_REVIEW_MODEL`.
4. Faça o deploy.

Nunca coloque `OPENAI_API_KEY` dentro de `index.html`.
