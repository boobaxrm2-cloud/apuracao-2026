"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { simular, type Apuracao, type Candidato, type CodigoEleicao, type Ponto, type ResultadoAbrangencia } from "@/lib/tse";

// Os dados vêm do branch `dados` deste repositório, gravados pelo coletor (GitHub Actions)
const REPO = "boobaxrm2-cloud/apuracao-2026";
const RAW = `https://raw.githubusercontent.com/${REPO}`;
// A API do GitHub sem login permite 60 consultas/hora por IP: 1 por minuto
const INTERVALO_S = 60;
const ELEICAO_2T: CodigoEleicao = "6258";
const ELEICAO_DEMO: CodigoEleicao = "6257";
const SIM_PERMITIDA = process.env.NODE_ENV === "development";
// Início da divulgação dos resultados: 25/10/2026, 17h de Brasília
const INICIO_APURACAO = new Date("2026-10-25T17:00:00-03:00");

const NOME_UF: Record<string, string> = {
  ac: "Acre", al: "Alagoas", am: "Amazonas", ap: "Amapá", ba: "Bahia", ce: "Ceará",
  df: "Distrito Federal", es: "Espírito Santo", go: "Goiás", ma: "Maranhão",
  mg: "Minas Gerais", ms: "Mato Grosso do Sul", mt: "Mato Grosso", pa: "Pará",
  pb: "Paraíba", pe: "Pernambuco", pi: "Piauí", pr: "Paraná", rj: "Rio de Janeiro",
  rn: "Rio Grande do Norte", ro: "Rondônia", rr: "Roraima", rs: "Rio Grande do Sul",
  sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo", to: "Tocantins", zz: "Exterior",
};

// Mapa em grade (coluna, linha): posição aproximada de cada UF
const GRADE: Record<string, [number, number]> = {
  rr: [1, 0], ap: [3, 0],
  am: [1, 1], pa: [2, 1], ma: [3, 1], ce: [4, 1], rn: [5, 1],
  ac: [0, 2], ro: [1, 2], mt: [2, 2], to: [3, 2], pi: [4, 2], pb: [5, 2],
  ms: [1, 3], go: [2, 3], df: [3, 3], ba: [4, 3], pe: [5, 3],
  pr: [1, 4], sp: [2, 4], mg: [3, 4], es: [4, 4], al: [5, 4],
  sc: [1, 5], rj: [3, 5], se: [5, 5],
  rs: [1, 6], zz: [4, 6],
};

const fmtInt = new Intl.NumberFormat("pt-BR");
const fmtPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${fmtPct.format(v)}%`;

type Modo = CodigoEleicao | "sim";
type Resposta = { status: "aguardando" } | ({ status: "ok" } & Apuracao);

function lerEleicaoDaUrl(): Modo {
  try {
    const p = new URLSearchParams(window.location.search).get("ele");
    if (p === ELEICAO_DEMO || p === ELEICAO_2T) return p;
    if (p === "sim" && SIM_PERMITIDA) return p;
  } catch {}
  return ELEICAO_2T;
}

// SHA do último commit do branch `dados`. Um arquivo lido pelo SHA nunca vem
// velho do cache do raw.githubusercontent.com (que ignora query string e guarda por 5 min).
async function refDosDados(): Promise<string> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/dados`, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github.sha" },
    });
    if (r.ok) return (await r.text()).trim();
  } catch {}
  return "dados"; // limite da API estourado: lê pelo branch (pode atrasar até 5 min)
}

export default function Painel() {
  const [ele, setEle] = useState<Modo | null>(null);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [proxima, setProxima] = useState(INTERVALO_S);
  const [historico, setHistorico] = useState<Ponto[]>([]);
  const ultimaRef = useRef("");
  const sim = useRef<{ base: Apuracao | null; progresso: number }>({ base: null, progresso: 0 });

  useEffect(() => setEle(lerEleicaoDaUrl()), []);

  const atualizar = useCallback(async () => {
    if (!ele) return;
    try {
      if (ele === "sim") {
        if (!sim.current.base) {
          const r = await fetch(`${RAW}/dados/${ELEICAO_2T}.json`, { cache: "no-store" });
          sim.current.base = await r.json();
        }
        sim.current.progresso = Math.min(100, sim.current.progresso + 4);
        const ap = simular(sim.current.base!, sim.current.progresso);
        setDados({ status: "ok", ...ap });
        const v: Record<string, number> = {};
        ap.brasil.candidatos.forEach((c) => (v[c.numero] = c.pct));
        setHistorico((h) => [...h, { a: ap.brasil.pctApurado, h: ap.brasil.atualizadoEm, v }]);
      } else {
        const ref = await refDosDados();
        if (ref !== "dados" && ref === ultimaRef.current) return; // nada novo
        const [ra, rh] = await Promise.all([
          fetch(`${RAW}/${ref}/${ele}.json`, { cache: "no-store" }),
          fetch(`${RAW}/${ref}/${ele}-historico.json`, { cache: "no-store" }),
        ]);
        if (ra.status === 404) {
          setDados({ status: "aguardando" });
        } else {
          if (!ra.ok) throw new Error("Falha ao ler os dados");
          setDados({ status: "ok", ...(await ra.json()) });
          setHistorico(rh.ok ? await rh.json() : []);
        }
        ultimaRef.current = ref;
      }
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao consultar");
    } finally {
      setProxima(INTERVALO_S);
    }
  }, [ele]);

  useEffect(() => {
    if (!ele) return;
    setDados(null);
    setHistorico([]);
    ultimaRef.current = "";
    sim.current = { base: null, progresso: 0 };
    atualizar();
    const timer = setInterval(() => {
      setProxima((s) => {
        if (s <= 1) {
          if (document.visibilityState === "visible") atualizar();
          return INTERVALO_S;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [ele, atualizar]);

  const trocarEleicao = (novo: Modo) => {
    const url = new URL(window.location.href);
    if (novo === ELEICAO_2T) url.searchParams.delete("ele");
    else url.searchParams.set("ele", novo);
    window.history.replaceState(null, "", url);
    setEle(novo);
  };

  // Cor segue o candidato (pelo número), nunca a posição no ranking
  const cores = useMemo(() => {
    const m: Record<string, string> = {};
    if (dados?.status !== "ok") return m;
    const dois = dados.brasil.candidatos.slice(0, 2).map((c) => c.numero).sort((a, b) => +a - +b);
    dois.forEach((n, i) => (m[n] = `var(--serie-${i + 1})`));
    return m;
  }, [dados]);

  const demo = ele === ELEICAO_DEMO;

  return (
    <main className="pagina">
      <header className="topo">
        <div>
          <p className="sobretitulo">Eleições 2026 · Presidente da República</p>
          <h1>Apuração do {demo ? "1º" : "2º"} turno</h1>
        </div>
        <Status dados={dados} erro={erro} proxima={proxima} />
      </header>

      {ele === "sim" && (
        <div className="aviso aviso-sim">
          <span><strong>SIMULAÇÃO</strong>: números fictícios, apenas para testar o site.</span>
        </div>
      )}

      {demo && (
        <div className="aviso">
          <span>Você está vendo o <strong>1º turno (04/10)</strong>, já encerrado, como demonstração.</span>
          <button className="botao-link" onClick={() => trocarEleicao(ELEICAO_2T)}>Ir para o 2º turno →</button>
        </div>
      )}

      {!dados && !erro && <div className="cartao carregando">Carregando dados do TSE…</div>}
      {!dados && erro && <div className="cartao carregando">{erro}</div>}

      {/* O TSE publica o arquivo zerado antes da eleição: 0% apurado = ainda não começou */}
      {(dados?.status === "aguardando" || (dados?.status === "ok" && dados.brasil.pctApurado === 0)) && (
        <Aguardando onDemo={() => trocarEleicao(ELEICAO_DEMO)} />
      )}

      {dados?.status === "ok" && (
        <>
          <Placar br={dados.brasil} cores={cores} demo={demo} />
          {dados.brasil.pctApurado > 0 && <Detalhes br={dados.brasil} />}
          <Estados estados={dados.estados} cores={cores} finalistas={dados.brasil.candidatos.slice(0, 2)} />
          {dados.brasil.pctApurado > 0 && !(dados.brasil.totalizacaoFinal && historico.length < 2) && (
            <Evolucao historico={historico} candidatos={dados.brasil.candidatos.slice(0, 2)} cores={cores} />
          )}
        </>
      )}

      <footer className="rodape">
        Dados oficiais do{" "}
        <a href="https://resultados.tse.jus.br" target="_blank" rel="noreferrer">Tribunal Superior Eleitoral</a>.
        Atualização automática a cada {INTERVALO_S} segundos. Este site não é afiliado ao TSE.
      </footer>
    </main>
  );
}

function Status({ dados, erro, proxima }: { dados: Resposta | null; erro: string | null; proxima: number }) {
  let rotulo = "Conectando";
  let tipo = "neutro";
  if (erro) { rotulo = "Sem conexão"; tipo = "erro"; }
  else if (dados?.status === "aguardando") { rotulo = "Aguardando início"; }
  else if (dados?.status === "ok") {
    if (dados.brasil.pctApurado === 0) { rotulo = "Aguardando início"; }
    else if (dados.brasil.totalizacaoFinal || dados.brasil.pctApurado >= 100) { rotulo = "Apuração encerrada"; tipo = "final"; }
    else { rotulo = "Ao vivo"; tipo = "vivo"; }
  }
  return (
    <div className="status">
      <span className={`pilula pilula-${tipo}`}><span className="ponto" aria-hidden />{rotulo}</span>
      <span className="status-info">
        {dados?.status === "ok" && <>TSE: {dados.brasil.atualizadoEm.slice(11)} · coletado {new Date(dados.consultadoEm).toLocaleTimeString("pt-BR")} · </>}
        próxima consulta em {proxima}s
      </span>
    </div>
  );
}

function Aguardando({ onDemo }: { onDemo: () => void }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const falta = Math.max(0, INICIO_APURACAO.getTime() - agora);
  const d = Math.floor(falta / 86_400_000);
  const h = Math.floor((falta / 3_600_000) % 24);
  const m = Math.floor((falta / 60_000) % 60);
  const s = Math.floor((falta / 1000) % 60);
  return (
    <section className="cartao aguardando">
      <h2>A apuração ainda não começou</h2>
      <p>
        O 2º turno acontece no <strong>domingo, 25 de outubro de 2026</strong>. O TSE começa a divulgar
        os resultados às <strong>17h (horário de Brasília)</strong>, quando as urnas fecham em todo o país.
        Deixe esta página aberta: ela atualiza sozinha.
      </p>
      {falta > 0 && (
        <div className="contagem" aria-label="Tempo até o início da divulgação">
          {[[d, "dias"], [h, "horas"], [m, "min"], [s, "seg"]].map(([v, r]) => (
            <div key={r as string}><strong>{String(v).padStart(2, "0")}</strong><span>{r}</span></div>
          ))}
        </div>
      )}
      <button className="botao" onClick={onDemo}>Ver o 1º turno como demonstração</button>
    </section>
  );
}

function Placar({ br, cores, demo }: { br: ResultadoAbrangencia; cores: Record<string, string>; demo: boolean }) {
  const [a, b] = br.candidatos;
  const outros = br.candidatos.slice(2);
  const diferenca = a && b ? a.votos - b.votos : 0;
  // Na barra dividida, os dois finalistas ficam sempre na mesma ordem (pelo número)
  const ordem = [a, b].filter(Boolean).sort((x, y) => +x.numero - +y.numero);
  const somaDois = ordem.reduce((s, c) => s + c.pct, 0) || 1;

  return (
    <section className="cartao">
      <div className="apurado">
        <div className="apurado-linha">
          <span><strong className="apurado-num">{pct(br.pctApurado)}</strong> das urnas apuradas</span>
          <span className="mudo">{fmtInt.format(br.secoesTotalizadas)} de {fmtInt.format(br.secoesTotal)} seções</span>
        </div>
        <div className="trilho" role="progressbar" aria-valuenow={br.pctApurado} aria-valuemin={0} aria-valuemax={100}>
          <div className="trilho-preenchido" style={{ width: `${br.pctApurado}%` }} />
        </div>
      </div>

      <div className="duelo">
        {ordem.map((c) => <CartaoCandidato key={c.numero} c={c} cor={cores[c.numero]} lider={c === a && br.pctApurado > 0} />)}
      </div>

      {ordem.length === 2 && (
        <div className="divisao" aria-hidden>
          <div className="divisao-barra">
            {ordem.map((c) => (
              <div key={c.numero} style={{ width: `${(c.pct / somaDois) * 100}%`, background: cores[c.numero] }} />
            ))}
          </div>
          <div className="divisao-meio"><span>50%</span></div>
        </div>
      )}

      {a && b && br.pctApurado > 0 && (
        <p className="diferenca">
          <strong>{a.nome}</strong> à frente por <strong>{fmtInt.format(diferenca)}</strong> votos
          ({fmtPct.format(a.pct - b.pct)} p.p.)
        </p>
      )}

      {demo && outros.length > 0 && (
        <details className="outros">
          <summary>Outros {outros.length} candidatos</summary>
          <table className="tabela">
            <tbody>
              {outros.map((c) => (
                <tr key={c.numero}>
                  <td>{c.nome} <span className="mudo">({c.partido})</span></td>
                  <td className="num">{fmtInt.format(c.votos)}</td>
                  <td className="num">{pct(c.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function CartaoCandidato({ c, cor, lider }: { c: Candidato; cor: string; lider: boolean }) {
  const [semFoto, setSemFoto] = useState(false);
  const selo = /eleito|turno/i.test(c.situacao) && !/não eleito/i.test(c.situacao) ? c.situacao : null;
  return (
    <article className={`candidato ${lider ? "candidato-lider" : ""}`} style={{ ["--cor" as string]: cor }}>
      <div className="candidato-topo">
        {semFoto ? (
          <div className="foto foto-vazia" aria-hidden>{c.nome.slice(0, 1)}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="foto" src={c.foto} alt="" width={56} height={56} onError={() => setSemFoto(true)} />
        )}
        <div className="candidato-nome">
          <span className="marca" aria-hidden />
          <h2>{c.nome}</h2>
          <span className="mudo">{c.partido} · {c.numero}</span>
        </div>
      </div>
      <div className="candidato-pct">{pct(c.pct)}</div>
      <div className="mudo">{fmtInt.format(c.votos)} votos</div>
      {selo && <span className="selo">✓ {selo}</span>}
    </article>
  );
}

function Detalhes({ br }: { br: ResultadoAbrangencia }) {
  const itens = [
    ["Votos válidos", fmtInt.format(br.validos), null],
    ["Brancos", fmtInt.format(br.brancos), pct(br.pctBrancos)],
    ["Nulos", fmtInt.format(br.nulos), pct(br.pctNulos)],
    ["Abstenção", fmtInt.format(br.abstencao), pct(br.pctAbstencao)],
  ];
  return (
    <section className="detalhes">
      {itens.map(([r, v, p]) => (
        <div key={r} className="detalhe">
          <span className="mudo">{r}</span>
          <strong>{v}</strong>
          {p && <span className="mudo">{p}</span>}
        </div>
      ))}
    </section>
  );
}

function Estados({ estados, cores, finalistas }: {
  estados: ResultadoAbrangencia[]; cores: Record<string, string>; finalistas: Candidato[];
}) {
  const [modo, setModo] = useState<"mapa" | "tabela">("mapa");
  const [sel, setSel] = useState<string | null>(null);
  const porUf = useMemo(() => Object.fromEntries(estados.map((e) => [e.uf, e])), [estados]);
  const numeros = finalistas.map((c) => c.numero).sort((a, b) => +a - +b);

  const doisDe = (e: ResultadoAbrangencia) =>
    numeros.map((n) => e.candidatos.find((c) => c.numero === n)).filter(Boolean) as Candidato[];

  const lideranca = (e?: ResultadoAbrangencia) => {
    if (!e || e.pctApurado === 0) return null;
    const [x, y] = doisDe(e).sort((p, q) => q.votos - p.votos);
    if (!x || !y || x.votos === y.votos) return null;
    const margem = x.pct - y.pct;
    return { lider: x, margem, nivel: margem < 5 ? 1 : margem < 15 ? 2 : 3 };
  };

  const selecionado = sel ? porUf[sel] : null;

  return (
    <section className="cartao">
      <div className="secao-topo">
        <h2>Por estado</h2>
        <div className="alternar" role="tablist">
          <button role="tab" aria-selected={modo === "mapa"} onClick={() => setModo("mapa")}>Mapa</button>
          <button role="tab" aria-selected={modo === "tabela"} onClick={() => setModo("tabela")}>Tabela</button>
        </div>
      </div>

      <div className="legenda">
        {numeros.map((n) => {
          const c = finalistas.find((f) => f.numero === n)!;
          return <span key={n}><i style={{ background: cores[n] }} />{c.nome} lidera</span>;
        })}
        <span className="mudo">Intensidade = vantagem: até 5, 5–15, mais de 15 p.p.</span>
      </div>

      {modo === "mapa" ? (
        <>
          <div className="grade" onMouseLeave={() => setSel(null)}>
            {Object.entries(GRADE).map(([uf, [col, lin]]) => {
              const e = porUf[uf];
              const l = lideranca(e);
              const fundo = l
                ? `color-mix(in oklab, ${cores[l.lider.numero]} ${[0, 30, 60, 100][l.nivel]}%, var(--superficie))`
                : undefined;
              return (
                <button
                  key={uf}
                  className={`ladrilho ${uf === "zz" ? "ladrilho-exterior" : ""} ${sel === uf ? "ladrilho-sel" : ""} ${l?.nivel === 3 ? "ladrilho-forte" : ""}`}
                  style={{ gridColumn: col + 1, gridRow: lin + 1, background: fundo }}
                  onMouseEnter={() => setSel(uf)}
                  onFocus={() => setSel(uf)}
                  onClick={() => setSel(uf)}
                  aria-label={`${NOME_UF[uf]}: ${l ? `${l.lider.nome} lidera com ${pct(l.lider.pct)}` : "sem votos apurados"}`}
                >
                  <strong>{uf === "zz" ? "EXT" : uf.toUpperCase()}</strong>
                  <span>{l ? `${Math.round(l.lider.pct)}%` : "—"}</span>
                </button>
              );
            })}
          </div>
          <div className="detalhe-uf" aria-live="polite">
            {selecionado ? (
              <>
                <div className="detalhe-uf-topo">
                  <strong>{NOME_UF[selecionado.uf]}</strong>
                  <span className="mudo">{pct(selecionado.pctApurado)} apurado</span>
                </div>
                {doisDe(selecionado).map((c) => (
                  <div key={c.numero} className="linha-cand">
                    <i style={{ background: cores[c.numero] }} />
                    <span>{c.nome}</span>
                    <span className="num">{pct(c.pct)}</span>
                    <span className="num mudo">{fmtInt.format(c.votos)}</span>
                  </div>
                ))}
              </>
            ) : (
              <span className="mudo">Passe o mouse ou toque em um estado para ver os números.</span>
            )}
          </div>
        </>
      ) : (
        <div className="rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>UF</th>
                <th className="num">Apurado</th>
                {numeros.map((n) => <th key={n} className="num">{finalistas.find((f) => f.numero === n)!.nome}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...estados].filter((e) => e.uf !== "br").sort((x, y) => NOME_UF[x.uf].localeCompare(NOME_UF[y.uf])).map((e) => {
                const l = lideranca(e);
                return (
                  <tr key={e.uf}>
                    <td>{NOME_UF[e.uf]}</td>
                    <td className="num mudo">{pct(e.pctApurado)}</td>
                    {doisDe(e).map((c) => (
                      <td key={c.numero} className={`num ${l?.lider.numero === c.numero ? "forte" : ""}`}>{pct(c.pct)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Evolucao({ historico, candidatos, cores }: {
  historico: Ponto[]; candidatos: Candidato[]; cores: Record<string, string>;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(600);
  const [foco, setFoco] = useState<number | null>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const numeros = candidatos.map((c) => c.numero).sort((a, b) => +a - +b);
  const pontos = historico.filter((p) => numeros.every((n) => n in p.v));

  const A = 220, mE = 40, mD = 12, mT = 12, mB = 28;
  const valores = pontos.flatMap((p) => numeros.map((n) => p.v[n]));
  const yMin = Math.floor(Math.min(45, ...valores) - 1);
  const yMax = Math.ceil(Math.max(55, ...valores) + 1);
  const x = (a: number) => mE + (a / 100) * (largura - mE - mD);
  const y = (v: number) => mT + (1 - (v - yMin) / (yMax - yMin)) * (A - mT - mB);
  const ticks = [yMin, 50, yMax].filter((v, i, arr) => arr.indexOf(v) === i);

  const aoMover = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left;
    let melhor = 0;
    pontos.forEach((p, i) => {
      if (Math.abs(x(p.a) - px) < Math.abs(x(pontos[melhor].a) - px)) melhor = i;
    });
    setFoco(melhor);
  };

  const pf = foco !== null ? pontos[foco] : null;

  return (
    <section className="cartao">
      <div className="secao-topo">
        <h2>Evolução da apuração</h2>
      </div>
      <div className="legenda">
        {numeros.map((n) => (
          <span key={n}><i style={{ background: cores[n] }} />{candidatos.find((c) => c.numero === n)!.nome}</span>
        ))}
        <span className="mudo">% dos votos válidos × % das urnas apuradas</span>
      </div>
      <div className="grafico" ref={caixa}>
        {pontos.length < 2 ? (
          <p className="mudo vazio">
            O gráfico aparece a partir da segunda atualização da apuração.
          </p>
        ) : (
          <>
            <svg width={largura} height={A} onPointerMove={aoMover} onPointerLeave={() => setFoco(null)} role="img"
              aria-label="Evolução do percentual de votos de cada candidato conforme as urnas são apuradas">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={mE} x2={largura - mD} y1={y(t)} y2={y(t)} className={t === 50 ? "eixo-50" : "grade-linha"} />
                  <text x={mE - 6} y={y(t)} className="rotulo-eixo" textAnchor="end" dominantBaseline="middle">{t}%</text>
                </g>
              ))}
              {[0, 25, 50, 75, 100].map((a) => (
                <text key={a} x={x(a)} y={A - 8} className="rotulo-eixo" textAnchor="middle">{a}%</text>
              ))}
              {numeros.map((n) => (
                <polyline key={n} fill="none" stroke={cores[n]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  points={pontos.map((p) => `${x(p.a)},${y(p.v[n])}`).join(" ")} />
              ))}
              {pf && (
                <g>
                  <line x1={x(pf.a)} x2={x(pf.a)} y1={mT} y2={A - mB} className="mira" />
                  {numeros.map((n) => (
                    <circle key={n} cx={x(pf.a)} cy={y(pf.v[n])} r={4.5} fill={cores[n]} stroke="var(--superficie)" strokeWidth={2} />
                  ))}
                </g>
              )}
            </svg>
            {pf && (
              <div className="dica" style={{ left: Math.min(Math.max(x(pf.a), 90), largura - 90) }}>
                <strong>{pct(pf.a)} apurado</strong>
                <span className="mudo">{pf.h.slice(11)}</span>
                {numeros.map((n) => (
                  <span key={n} className="linha-cand">
                    <i style={{ background: cores[n] }} />
                    {candidatos.find((c) => c.numero === n)!.nome}
                    <span className="num">{pct(pf.v[n])}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
