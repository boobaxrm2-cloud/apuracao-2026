// Coletor: busca o TSE periodicamente e grava os resultados no branch `dados`
// (o "banco de dados" do site). Roda no GitHub Actions; o Node 24 executa
// TypeScript direto (type stripping), sem build.
//
// Uso: node coletor/coletar.ts --eleicao 6258 --duracao 330 --intervalo 30 --saida saida
//   --duracao 0 = coleta uma vez só.
// Cada rodada grava em <saida>/:
//   <eleicao>.json            resultado atual (nacional + estados)
//   <eleicao>-historico.json  pontos do gráfico de evolução
// e publica no branch `dados` com um único commit (force push), para o
// repositório não crescer a cada atualização.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ELEICOES, carregarApuracao, pontoDe, type CodigoEleicao, type Ponto } from "../lib/tse.ts";

const { values } = parseArgs({
  options: {
    eleicao: { type: "string", default: "6258" },
    duracao: { type: "string", default: "330" }, // minutos
    intervalo: { type: "string", default: "30" }, // segundos
    saida: { type: "string", default: "saida" },
    "sem-push": { type: "boolean", default: false },
  },
});

const ele = values.eleicao as CodigoEleicao;
if (!(ele in ELEICOES)) throw new Error(`Eleição inválida: ${ele}`);
const fim = Date.now() + Number(values.duracao) * 60_000;
const intervaloMs = Number(values.intervalo) * 1000;
const saida = values.saida!;

const arqAtual = join(saida, `${ele}.json`);
const arqHist = join(saida, `${ele}-historico.json`);

const git = (...args: string[]) => execFileSync("git", args, { cwd: saida, stdio: "pipe" }).toString().trim();

function lerJson<T>(arq: string, padrao: T): T {
  try {
    return existsSync(arq) ? JSON.parse(readFileSync(arq, "utf8")) : padrao;
  } catch {
    return padrao;
  }
}

function publicar(msg: string) {
  if (values["sem-push"]) return;
  // Recria o branch com um único commit e força o push
  git("checkout", "-q", "--orphan", "tmp-dados");
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  try { git("branch", "-q", "-D", "dados"); } catch {}
  git("branch", "-q", "-m", "dados");
  git("push", "-q", "-f", "origin", "dados");
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ultimaVersao = "";
let rodada = 0;
while (true) {
  rodada++;
  try {
    const ap = await carregarApuracao(ele);
    if (!ap) {
      console.log(`[${rodada}] TSE ainda não publicou o arquivo de ${ele}`);
    } else {
      const versao = `${ap.brasil.atualizadoEm}|${ap.estados.map((e) => e.atualizadoEm).join(",")}`;
      if (versao === ultimaVersao) {
        console.log(`[${rodada}] sem novidade (${ap.brasil.pctApurado.toFixed(2)}%)`);
      } else {
        ultimaVersao = versao;
        const hist = lerJson<Ponto[]>(arqHist, []);
        const ultimo = hist[hist.length - 1];
        if (ap.brasil.pctApurado > 0 && (!ultimo || ultimo.a !== ap.brasil.pctApurado)) {
          hist.push(pontoDe(ap.brasil));
        }
        writeFileSync(arqAtual, JSON.stringify(ap));
        writeFileSync(arqHist, JSON.stringify(hist));
        publicar(`${ELEICOES[ele].nome}: ${ap.brasil.pctApurado.toFixed(2)}% apurado (TSE ${ap.brasil.atualizadoEm})`);
        console.log(`[${rodada}] publicado: ${ap.brasil.pctApurado.toFixed(2)}% · TSE ${ap.brasil.atualizadoEm}`);
        if (ap.brasil.totalizacaoFinal && ap.brasil.pctApurado >= 100) {
          console.log("Totalização final: encerrando o coletor.");
          break;
        }
      }
    }
  } catch (e) {
    console.error(`[${rodada}] falha:`, e instanceof Error ? e.message : e);
  }
  if (Date.now() + intervaloMs >= fim) break;
  await espera(intervaloMs);
}
