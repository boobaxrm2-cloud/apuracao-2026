import { ELEICOES, obterApuracao, obterSimulacao, type CodigoEleicao } from "@/lib/tse";

export const dynamic = "force-dynamic";

const PADRAO = (process.env.ELEICAO_PADRAO ?? "6258") as CodigoEleicao;

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("ele") ?? PADRAO;

  if (param === "sim") {
    if (process.env.PERMITIR_SIMULACAO !== "1") {
      return Response.json({ erro: "Simulação desabilitada" }, { status: 404 });
    }
    return Response.json(await obterSimulacao(), { headers: { "Cache-Control": "no-store" } });
  }

  const ele = param as CodigoEleicao;
  if (!(ele in ELEICOES)) {
    return Response.json({ erro: "Eleição inválida" }, { status: 400 });
  }

  try {
    const dados = await obterApuracao(ele);
    return Response.json(dados, {
      headers: {
        // CDN (Vercel) segura a resposta por 15s: aguenta picos de acesso sem bater no TSE
        "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch {
    return Response.json(
      { erro: "Não foi possível consultar o TSE agora. Tentando novamente…" },
      { status: 502 },
    );
  }
}
