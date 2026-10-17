# Apuração 2026 · Presidente

Painel para acompanhar em tempo real a apuração do 2º turno da eleição presidencial de 2026
(25/10/2026), com os dados oficiais publicados pelo TSE.

## Rodar localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

- `/` mostra o 2º turno (código TSE **6258**). Antes de começar, aparece a contagem regressiva.
- `/?ele=6257` mostra o 1º turno (já encerrado) como demonstração.
- `/?ele=sim` é uma simulação de apuração ao vivo. Só funciona com `PERMITIR_SIMULACAO=1`
  (ex.: `PERMITIR_SIMULACAO=1 npm run dev`). **Nunca ligue em produção.**

## Publicar (Vercel)

1. Suba esta pasta para um repositório no GitHub.
2. Em vercel.com → *Add New Project*, importe o repositório (detecta Next.js sozinho).
3. Não precisa de variáveis de ambiente.

## Como funciona

```
TSE (JSON)  ←  /api/resultados (cache 15s em memória + CDN)  ←  navegador (consulta a cada 15s)
```

- Fonte: `https://resultados.tse.jus.br/oficial/ele2026/<cód>/dados/<uf>/<uf>-c0001-e<cód>-u.json`
  (`c0001` = Presidente; `br` = nacional; 27 UFs + `zz` = exterior).
- Os códigos das eleições vêm de `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`.
- O TSE não envia cabeçalhos CORS, por isso o navegador consulta a rota `/api/resultados`, não o TSE direto.
- Com o cache de 15s na CDN (`s-maxage=15`), o TSE recebe no máximo uma rodada de consultas a cada
  15s, não importa quantas pessoas estejam no site.
- O gráfico de evolução é montado no navegador de cada visitante (localStorage) enquanto a página
  fica aberta.

## Arquivos

- `lib/tse.ts`: busca, normalização e cache dos dados do TSE (+ simulação)
- `app/api/resultados/route.ts`: rota de API usada pelo front
- `app/Painel.tsx`: interface (placar, estados, evolução)
- `app/globals.css`: estilos (tema claro/escuro automático)
