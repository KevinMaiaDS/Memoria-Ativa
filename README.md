# Memória Ativa

Aplicativo de recuperação ativa com geração de perguntas por IA.

## IA hospedada

A geração semântica usa a Gemini API da Google. A chave **não** fica no HTML: configure `GEMINI_API_KEY` como variável de ambiente na Vercel.

Modelo padrão: `gemini-3.8-flash`.

O fluxo da geração é:

1. material → fatos atômicos;
2. fatos + material → perguntas candidatas;
3. material + candidatas → auditoria final.

O aplicativo mantém um gerador local como fallback, mas a geração local não substitui a qualidade da geração semântica por IA.

## Vercel

Variáveis recomendadas:

- `GEMINI_API_KEY` — obrigatória para geração com IA.
- `GEMINI_MODEL` — opcional; padrão `gemini-3.8-flash`.

Não coloque a chave no `index.html` nem no GitHub.

## Execução local

```bash
npm start
```

Para usar IA localmente, defina `GEMINI_API_KEY` no ambiente antes de iniciar o servidor.
