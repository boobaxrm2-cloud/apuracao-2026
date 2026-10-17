// Busca e normaliza os arquivos públicos de resultados do TSE.
// Formato descoberto em resultados.tse.jus.br/oficial/comum/config/ele-c.json:
//   <base>/oficial/ele2026/<cd_eleicao>/dados/<uf>/<uf>-c0001-e<cd_eleicao 6 dígitos>-u.json
// c0001 = cargo Presidente.
// Usado pelo coletor (Node, GitHub Actions) e, só para tipos/simulação, pelo site.

const BASE = "https://resultados.tse.jus.br/oficial/ele2026";

// Códigos das eleições presidenciais de 2026 (lidos do ele-c.json do TSE)
export const ELEICOES = {
  "6258": { nome: "2º turno", turno: 2 },
  "6257": { nome: "1º turno", turno: 1 },
} as const;
export type CodigoEleicao = keyof typeof ELEICOES;

export const UFS = [
  "ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt", "pa",
  "pb", "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se", "sp", "to", "zz",
] as const;

export type Candidato = {
  numero: string;
  nome: string;
  partido: string;
  sqcand: string;
  foto: string;
  votos: number;
  pct: number;
  eleito: boolean;
  situacao: string;
};

export type ResultadoAbrangencia = {
  uf: string;
  atualizadoEm: string; // "dd/mm/aaaa hh:mm:ss" (horário de Brasília)
  pctApurado: number; // % de seções totalizadas
  secoesTotalizadas: number;
  secoesTotal: number;
  eleitorado: number;
  comparecimento: number;
  abstencao: number;
  pctAbstencao: number;
  validos: number;
  brancos: number;
  pctBrancos: number;
  nulos: number;
  pctNulos: number;
  totalizacaoFinal: boolean;
  candidatos: Candidato[];
};

export type Apuracao = {
  eleicao: CodigoEleicao;
  consultadoEm: string; // ISO, quando o coletor leu o TSE
  brasil: ResultadoAbrangencia;
  estados: ResultadoAbrangencia[];
};

// Um ponto do gráfico de evolução: % apurado → % de cada finalista
export type Ponto = { a: number; h: string; v: Record<string, number> };

const num = (v: unknown) => Number(String(v ?? "0").replace(",", ".")) || 0;
const int = (v: unknown) => parseInt(String(v ?? "0"), 10) || 0;

function urlArquivo(ele: CodigoEleicao, uf: string) {
  return `${BASE}/${ele}/dados/${uf}/${uf}-c0001-e${ele.padStart(6, "0")}-u.json`;
}

export function urlFoto(ele: CodigoEleicao, sqcand: string) {
  return `${BASE}/${ele}/fotos/br/${sqcand}.jpeg`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizar(ele: CodigoEleicao, d: any): ResultadoAbrangencia {
  const candidatos: Candidato[] = [];
  const cargo = d.carg?.[0];
  for (const agr of cargo?.agr ?? []) {
    for (const par of agr.par ?? []) {
      for (const c of par.cand ?? []) {
        candidatos.push({
          numero: c.n,
          nome: c.nmu,
          partido: par.sg,
          sqcand: c.sqcand,
          foto: urlFoto(ele, c.sqcand),
          votos: int(c.vap),
          pct: num(c.pvapn),
          // "e" também vem "s" para quem foi ao 2º turno; a situação é mais confiável
          eleito: /^eleito/i.test(c.st ?? ""),
          situacao: c.st ?? "",
        });
      }
    }
  }
  candidatos.sort((a, b) => b.votos - a.votos || a.numero.localeCompare(b.numero));

  return {
    uf: d.cdabr,
    atualizadoEm: `${d.dg} ${d.hg}`,
    pctApurado: num(d.s?.pstn),
    secoesTotalizadas: int(d.s?.st),
    secoesTotal: int(d.s?.ts),
    eleitorado: int(d.e?.te),
    comparecimento: int(d.e?.c),
    abstencao: int(d.e?.a),
    pctAbstencao: num(d.e?.pan),
    validos: int(d.v?.vv),
    brancos: int(d.v?.vb),
    pctBrancos: num(d.v?.pvbn),
    nulos: int(d.v?.tvn),
    pctNulos: num(d.v?.ptvnn),
    totalizacaoFinal: d.tf === "s",
    candidatos,
  };
}

async function buscar(ele: CodigoEleicao, uf: string) {
  const res = await fetch(urlArquivo(ele, uf), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "apuracao-2026 (painel de acompanhamento)" },
  });
  if (!res.ok) return null; // 404 = arquivo ainda não publicado
  return normalizar(ele, await res.json());
}

// null = TSE ainda não publicou o arquivo nacional
export async function carregarApuracao(ele: CodigoEleicao): Promise<Apuracao | null> {
  const brasil = await buscar(ele, "br");
  if (!brasil) return null;
  const estados = (
    await Promise.all(UFS.map((uf) => buscar(ele, uf).catch(() => null)))
  ).filter((r): r is ResultadoAbrangencia => r !== null);
  return { eleicao: ele, consultadoEm: new Date().toISOString(), brasil, estados };
}

export function pontoDe(br: ResultadoAbrangencia): Ponto {
  const v: Record<string, number> = {};
  br.candidatos.slice(0, 2).forEach((c) => (v[c.numero] = c.pct));
  return { a: br.pctApurado, h: br.atualizadoEm, v };
}

// ---------------------------------------------------------------------------
// Simulação (só no `npm run dev`, com /?ele=sim): parte do arquivo real do
// 2º turno (zerado) e "apura" um pouco a cada consulta.

function semente(uf: string) {
  let h = 0;
  for (const ch of uf) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return h / 1000; // 0..1, estável por UF
}

function simularAbrangencia(r: ResultadoAbrangencia, progresso: number): ResultadoAbrangencia {
  const s = semente(r.uf);
  const pctApurado = r.uf === "br" ? progresso : Math.min(100, progresso * (0.7 + s * 0.6));
  const fator = pctApurado / 100;
  const comparecimento = Math.round(r.eleitorado * 0.79 * fator);
  const brancos = Math.round(comparecimento * 0.018);
  const nulos = Math.round(comparecimento * 0.03);
  const validos = comparecimento - brancos - nulos;
  // Divisão varia por UF e oscila conforme a apuração avança (como na vida real)
  const parteA = 0.5 + (s - 0.5) * 0.4 + Math.sin(fator * 3 + s * 6) * 0.02;
  const [ca, cb] = [...r.candidatos].sort((a, b) => +a.numero - +b.numero);
  const votosA = Math.round(validos * parteA);
  const candidatos = [
    { ...ca, votos: votosA, pct: validos ? (votosA / validos) * 100 : 0 },
    { ...cb, votos: validos - votosA, pct: validos ? ((validos - votosA) / validos) * 100 : 0 },
  ].sort((a, b) => b.votos - a.votos);
  return {
    ...r,
    pctApurado,
    secoesTotalizadas: Math.round(r.secoesTotal * fator),
    comparecimento,
    abstencao: r.eleitorado - Math.round(r.eleitorado * 0.79),
    pctAbstencao: 21,
    validos,
    brancos,
    pctBrancos: comparecimento ? (brancos / comparecimento) * 100 : 0,
    nulos,
    pctNulos: comparecimento ? (nulos / comparecimento) * 100 : 0,
    totalizacaoFinal: pctApurado >= 100,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(",", ""),
    candidatos,
  };
}

export function simular(base: Apuracao, progresso: number): Apuracao {
  // O nacional é a soma dos estados, para o mapa e o placar baterem
  const estados = base.estados.map((e) => simularAbrangencia(e, progresso));
  const brasil = simularAbrangencia(base.brasil, progresso);
  const somaPor = (n: string) =>
    estados.reduce((t, e) => t + (e.candidatos.find((c) => c.numero === n)?.votos ?? 0), 0);
  const validos = brasil.candidatos.reduce((t, c) => t + somaPor(c.numero), 0);
  brasil.candidatos = brasil.candidatos
    .map((c) => ({ ...c, votos: somaPor(c.numero), pct: validos ? (somaPor(c.numero) / validos) * 100 : 0 }))
    .sort((a, b) => b.votos - a.votos);
  brasil.validos = validos;
  return { ...base, consultadoEm: new Date().toISOString(), brasil, estados };
}
