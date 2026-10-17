# Apuração 2026 · Presidente

Painel para acompanhar em tempo real a apuração do 2º turno da eleição presidencial de 2026
(25/10/2026), com os dados oficiais publicados pelo TSE. Roda 100% no GitHub:

- **Site:** https://boobaxrm2-cloud.github.io/apuracao-2026/ (GitHub Pages)
- **Banco de dados:** o branch [`dados`](../../tree/dados) deste repositório
- **Coletor:** o workflow *Coletar apuração* (GitHub Actions)

## Como funciona

```
TSE (JSON) ──a cada 30s──▶ coletor (GitHub Actions) ──push──▶ branch `dados`
                                                                   │
                     navegador ◀── raw.githubusercontent.com ◀─────┘ (a cada 60s)
```

- O coletor (`coletor/coletar.ts`) lê o nacional e os 28 arquivos de UF do TSE e grava
  `6258.json` (resultado atual) e `6258-historico.json` (pontos do gráfico de evolução) no
  branch `dados`. O branch fica sempre com um único commit (force push), para o repositório
  não crescer.
- O site pega o SHA do último commit do `dados` pela API do GitHub e lê os arquivos por esse
  SHA. Assim nunca vem uma versão velha do cache do `raw.githubusercontent.com` (que ignora
  `?t=` e segura por 5 min). A API sem login permite 60 consultas/hora por IP, por isso o site
  atualiza a cada 60s. Se o limite estourar, lê pelo nome do branch (pode atrasar até 5 min).
- O TSE não envia cabeçalhos CORS; por isso o navegador nunca consulta o TSE direto.

## No dia da eleição (25/10)

O workflow *Coletar apuração* está agendado para 16h45 de Brasília e coleta por 5h30.
O agendamento do GitHub pode atrasar: **por volta das 16h50, abra Actions → Coletar apuração →
Run workflow** (eleição 6258, duração 330) para garantir. Só roda um coletor por vez; um disparo
extra fica na fila.

## Rodar localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

- `/` mostra o 2º turno; `/?ele=6257` mostra o 1º turno (encerrado) como demonstração.
- `/?ele=sim` simula uma apuração ao vivo (só no `npm run dev`, nunca no site publicado).
- `npm run coletar -- --eleicao 6258 --duracao 0 --saida pasta --sem-push` testa o coletor.

## Arquivos

- `lib/tse.ts`: busca e normalização dos dados do TSE (+ simulação)
- `coletor/coletar.ts`: coletor que grava no branch `dados`
- `app/Painel.tsx`: interface (placar, estados, evolução)
- `app/globals.css`: estilos (tema claro/escuro automático)
- `.github/workflows/publicar-site.yml`: build e deploy do site no Pages a cada push na `main`
- `.github/workflows/coletar.yml`: coletor
