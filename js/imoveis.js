// Anúncios: leitura de data/imoveis.json, validação, preço, filtros e mensagens de WhatsApp.
// Funções puras (sem DOM): usadas pelo catálogo, pela página de detalhes e pelos testes em Node.
import { site } from "./config.js";
import { waLink } from "./whatsapp.js";

export const TIPOS_SEM_COMODOS = ["Terreno"]; // não mostram quartos, banheiros e vagas
const ROOT = new URL("../", import.meta.url); // raiz do site, para resolver caminhos das fotos

const texto = (v) => (typeof v === "string" ? v.trim() : "");
const inteiro = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** Preço em reais só quando é um número positivo; qualquer outra coisa vira "sob consulta" (null). */
export function precoValido(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export function formatarPreco(preco) {
  const v = precoValido(preco);
  return v === null ? "Valor sob consulta" : brl.format(v).replace(/ /g, " ");
}

export const localizacao = (im) => [im.bairro, im.cidade].filter(Boolean).join(", ");

/**
 * Normaliza um anúncio do arquivo de dados. Devolve null (com o motivo em `problemas`) quando falta
 * informação mínima para publicar: id, título, tipo, cidade e ao menos uma foto com texto alternativo.
 */
export function normalizar(bruto, problemas = []) {
  const id = texto(bruto?.id);
  const faltando = [];
  if (!/^[a-z0-9-]+$/.test(id)) faltando.push("id (letras minúsculas, números e hífens)");
  const titulo = texto(bruto?.titulo);
  const tipo = texto(bruto?.tipo);
  const cidade = texto(bruto?.cidade);
  // ordem das fotos = ordem no arquivo; a primeira é a capa
  const fotos = (Array.isArray(bruto?.fotos) ? bruto.fotos : [])
    .map((f) => ({
      arquivo: texto(f?.arquivo),
      miniatura: texto(f?.miniatura) || texto(f?.arquivo),
      alt: texto(f?.alt),
      foco: /^\d{1,3}% \d{1,3}%$/.test(texto(f?.foco)) ? texto(f.foco) : "50% 50%", // enquadramento na galeria
      largura: inteiro(f?.largura),
      altura: inteiro(f?.altura),
    }))
    .filter((f) => f.arquivo && f.alt);
  if (!titulo) faltando.push("titulo");
  if (!tipo) faltando.push("tipo");
  if (!cidade) faltando.push("cidade");
  if (!fotos.length) faltando.push("fotos (arquivo + alt)");
  if (faltando.length) {
    problemas.push(`${id || "(sem id)"}: falta ${faltando.join(", ")}`);
    return null;
  }
  const comodos = !TIPOS_SEM_COMODOS.includes(tipo);
  return {
    id,
    referencia: texto(bruto.referencia),
    titulo,
    tipo,
    cidade,
    bairro: texto(bruto.bairro),
    preco: precoValido(bruto.preco),
    areas: (Array.isArray(bruto.areas) ? bruto.areas : [])
      .map((a) => ({ rotulo: texto(a?.rotulo), m2: typeof a?.m2 === "number" && a.m2 > 0 ? a.m2 : null }))
      .filter((a) => a.rotulo && a.m2),
    quartos: comodos ? inteiro(bruto.quartos) : null,
    banheiros: comodos ? inteiro(bruto.banheiros) : null,
    vagas: comodos ? inteiro(bruto.vagas) : null,
    caracteristicas: (Array.isArray(bruto.caracteristicas) ? bruto.caracteristicas : []).map(texto).filter(Boolean),
    descricao: texto(bruto.descricao),
    fotos,
  };
}

/** Só os anúncios com "publicado": true e informação suficiente, sem ids repetidos. */
export function publicados(dados, problemas = []) {
  const lista = Array.isArray(dados?.imoveis) ? dados.imoveis : [];
  const vistos = new Set();
  const out = [];
  for (const bruto of lista) {
    if (bruto?.publicado !== true) continue;
    const im = normalizar(bruto, problemas);
    if (!im) continue;
    if (vistos.has(im.id)) {
      problemas.push(`${im.id}: id repetido`);
      continue;
    }
    vistos.add(im.id);
    out.push(im);
  }
  return out;
}

export async function carregarImoveis() {
  const res = await fetch(new URL("data/imoveis.json", ROOT), { cache: "no-cache" });
  if (!res.ok) throw new Error(`data/imoveis.json: ${res.status}`);
  const problemas = [];
  const lista = publicados(await res.json(), problemas);
  problemas.forEach((p) => console.warn(`Anúncio não publicado — ${p}`));
  return lista;
}

export const urlFoto = (arquivo) => new URL(arquivo, ROOT).href;
export const urlDetalhes = (im) => new URL(`imovel/?id=${encodeURIComponent(im.id)}`, ROOT).href;
/** Link público (domínio do site, nunca localhost) para mandar na conversa. */
export const urlPublica = (im) => `${site.siteUrl.replace(/\/$/, "")}/imovel/?id=${encodeURIComponent(im.id)}`;

/** Características em linha, sem cômodos em terrenos. */
export function caracteristicasResumo(im) {
  const out = im.areas.map((a) => `${a.rotulo}: ${a.m2.toLocaleString("pt-BR")} m²`);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  if (im.quartos !== null) out.push(plural(im.quartos, "quarto", "quartos"));
  if (im.banheiros !== null) out.push(plural(im.banheiros, "banheiro", "banheiros"));
  if (im.vagas !== null) out.push(plural(im.vagas, "vaga", "vagas"));
  return out;
}

// ---------- mensagens: só os campos que existem, sem variáveis soltas ----------
function sobreImovel(im) {
  let s = im.titulo ? ` ${im.titulo}` : "";
  if (im.referencia) s += `, referência ${im.referencia}`;
  const local = localizacao(im);
  if (local) s += `, em ${local}`;
  return s;
}
export function mensagemInteresse(im) {
  return `Olá, Marcos! Tenho interesse no imóvel${sobreImovel(im)}. Gostaria de receber mais informações.\n${urlPublica(im)}`;
}
export function mensagemVisita(im) {
  return `Olá, Marcos! Gostaria de agendar uma visita ao imóvel${sobreImovel(im)}.\n${urlPublica(im)}`;
}
/** Botão "Quero conhecer este terreno": cada anúncio envia a própria identificação. */
export function mensagemConhecer(im) {
  const tipo = im.tipo.toLowerCase();
  // "Vi o terreno em Joanópolis/SP" quando o título já começa pelo tipo; senão "Vi o terreno «título»"
  const nome = im.titulo.toLowerCase().startsWith(tipo) ? `o ${tipo}${im.titulo.slice(tipo.length)}` : `o ${tipo} “${im.titulo}”`;
  let s = `Olá, Marcos! Vi ${nome}`;
  if (im.referencia) s += `, referência ${im.referencia}`;
  // cidade já citada no título: basta o bairro
  if (im.titulo.includes(im.cidade)) {
    if (im.bairro) s += `, no bairro ${im.bairro}`;
  } else {
    s += `, em ${localizacao(im)}`;
  }
  return `${s}, no site da Renovato Imóveis. Gostaria de receber mais informações e combinar uma visita.\n${urlPublica(im)}`;
}
export const linkConhecer = (im) => waLink(site.whatsappNumber, mensagemConhecer(im));
export const linkInteresse = (im) => waLink(site.whatsappNumber, mensagemInteresse(im));
export const linkVisita = (im) => waLink(site.whatsappNumber, mensagemVisita(im));

// ---------- seção de terrenos: busca por localidade, valor máximo e área mínima ----------
/** Valor máximo: o mínimo da escala (R$ 0) não é o preço de nenhum anúncio. */
export const ORCAMENTO = { min: 0, max: 270000, passo: 1000 };
export const BUSCA_PADRAO = Object.freeze({ local: "", max: ORCAMENTO.max, areaMin: null });

export const terrenos = (lista) => lista.filter((im) => im.tipo === "Terreno");

/** Área do terreno (nunca a construída): "Área do terreno" ou "Área total"; ausente → null, nunca zero. */
export function areaTerreno(im) {
  const a = im.areas.find((x) => /terreno|total/i.test(x.rotulo) && !/constru/i.test(x.rotulo));
  return a ? a.m2 : null;
}

export const chaveLocal = (im) => `${im.bairro}|${im.cidade}`;
export const rotuloLocal = (im) => (im.bairro ? `${im.bairro} — ${im.cidade}` : im.cidade);

/** Localidades reais dos terrenos publicados, sem repetição, em ordem alfabética. */
export function opcoesLocal(lista) {
  const mapa = new Map(terrenos(lista).map((im) => [chaveLocal(im), rotuloLocal(im)]));
  return [...mapa].map(([valor, rotulo]) => ({ valor, rotulo })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/** Áreas reais dos terrenos (atalhos do campo "Área mínima"), em ordem crescente. */
export const opcoesArea = (lista) => [...new Set(terrenos(lista).map(areaTerreno).filter((m) => m !== null))].sort((a, b) => a - b);

/**
 * Filtros combinados: localidade igual à escolhida, preço ≤ valor máximo e área ≥ área mínima.
 * Sem preço nunca entra (não é "grátis"); com área mínima definida, sem área informada também não entra.
 */
export function filtrarTerrenos(lista, { local = "", max = ORCAMENTO.max, areaMin = null } = {}) {
  return terrenos(lista).filter((im) => {
    if (local && chaveLocal(im) !== local) return false;
    if (im.preco === null || im.preco > max) return false;
    if (areaMin !== null) {
      const a = areaTerreno(im);
      if (a === null || a < areaMin) return false;
    }
    return true;
  });
}

const soDigitos = (texto) => String(texto ?? "").replace(/R\$|\s|\./g, "").replace(/,00$/, "");

/** Valor digitado no campo "Valor máximo": inteiro de R$ 0 a R$ 270.000. */
export function validarValor(texto) {
  const s = soDigitos(texto);
  if (!s) return { valor: null, aviso: `Informe um valor de R$ 0 a ${formatarPreco(ORCAMENTO.max)}.` };
  if (!/^\d+$/.test(s)) return { valor: null, aviso: `Use apenas números, de R$ 0 a ${formatarPreco(ORCAMENTO.max)}.` };
  const n = Number(s);
  if (n > ORCAMENTO.max) return { valor: ORCAMENTO.max, aviso: `O valor máximo da busca é ${formatarPreco(ORCAMENTO.max)}.` };
  return { valor: n, aviso: "" };
}

/** Área digitada no campo "Área mínima": vazio = qualquer área; senão um inteiro maior que zero, em m². */
export function validarArea(texto) {
  const s = soDigitos(texto).replace(/m²|m2/gi, "");
  if (!s) return { valor: null, aviso: "" };
  if (!/^\d+$/.test(s)) return { valor: undefined, aviso: "Informe a área em m², usando apenas números." };
  const n = Number(s);
  if (n === 0) return { valor: undefined, aviso: "Informe uma área maior que zero ou deixe em branco." };
  return { valor: n, aviso: "" };
}

export const textoArea = (m2) => `A partir de ${m2.toLocaleString("pt-BR")} m²`;

/** Terrenos publicados que o controle nunca mostra: acima do teto ou sem preço (pendências a informar). */
export function foraDoOrcamento(lista) {
  return terrenos(lista).filter((im) => im.preco === null || im.preco > ORCAMENTO.max);
}

export const contagemTerrenos = (n) => (n === 0 ? "Nenhum terreno encontrado" : `${n} ${n === 1 ? "terreno encontrado" : "terrenos encontrados"}`);
export const textoOrcamento = (v) => `Até ${brl.format(v).replace(/ /g, " ")}`;
