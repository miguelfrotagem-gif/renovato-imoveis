import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { site } from "../js/config.js";
import { normalizeNumber, waLink } from "../js/whatsapp.js";
import { publicados, formatarPreco, ORCAMENTO, filtrarTerrenos, opcoesLocal, opcoesArea, areaTerreno, validarValor, validarArea, textoArea, foraDoOrcamento, contagemTerrenos, textoOrcamento, caracteristicasResumo, mensagemInteresse, mensagemVisita, mensagemConhecer } from "../js/imoveis.js";
import { PAGES, syncContacts, sitemap, robots } from "../tools/build.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const html = await read("index.html");
const detalhe = await read("imovel/index.html");
const policy = await read("politica-de-privacidade/index.html");
const pagina404 = await read("404.html");
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const tags = (src, re) => [...src.matchAll(re)].map((m) => m[0]);

// anúncios de teste (só nos testes; o site publica apenas data/imoveis.json)
const FIXTURE = {
  imoveis: [
    { id: "casa-a", referencia: "T-1", publicado: true, titulo: "Casa A", tipo: "Casa", cidade: "Atibaia", bairro: "Centro", preco: 500000, areas: [{ rotulo: "Área construída", m2: 150 }], quartos: 3, banheiros: 2, vagas: 2, fotos: [{ arquivo: "x.webp", alt: "Fachada" }] },
    { id: "terreno-b", referencia: "T-2", publicado: true, titulo: "Terreno B", tipo: "Terreno", cidade: "Piracaia", preco: null, quartos: 2, vagas: 1, areas: [{ rotulo: "Área do terreno", m2: 450 }], fotos: [{ arquivo: "y.webp", alt: "Terreno" }] },
    { id: "apto-c", publicado: true, titulo: "Apartamento C", tipo: "Apartamento", cidade: "Atibaia", preco: 0, fotos: [{ arquivo: "z.webp", alt: "Sala" }] },
    { id: "rascunho", publicado: false, titulo: "Rascunho", tipo: "Casa", cidade: "Atibaia", fotos: [{ arquivo: "w.webp", alt: "x" }] },
    { id: "sem-foto", publicado: true, titulo: "Sem foto", tipo: "Casa", cidade: "Atibaia", fotos: [] },
  ],
};

test("waLink: sem número não gera link; número e mensagem codificados", () => {
  assert.equal(waLink("", "Olá"), null);
  assert.equal(waLink("123", "Olá"), null);
  assert.equal(normalizeNumber("+55 11 92599-3517"), "5511925993517");
  assert.equal(waLink("5511925993517", "Olá, Marcos! Preços & condições?"), "https://wa.me/5511925993517?text=Ol%C3%A1%2C%20Marcos!%20Pre%C3%A7os%20%26%20condi%C3%A7%C3%B5es%3F");
  assert.equal(waLink("5511925993517"), "https://wa.me/5511925993517");
});

test("config: dados profissionais e contatos confirmados", () => {
  assert.equal(site.ownerFullName, "Marcos Roberto Schiripa");
  assert.equal(site.ownerName, "Marcos Schiripa");
  assert.equal(site.role, "Corretor de imóveis independente");
  assert.equal(site.creci, "CRECI 330533/SP");
  assert.equal(site.region, "Atibaia e região");
  assert.equal(site.whatsappNumber, "5511925993517");
  assert.equal(site.phone, "+5511925993517");
  assert.equal(site.email, "marcos.schiripa@creci.org.br");
  assert.deepEqual(site.instagram, { handle: "@marcos.schiripa", url: "https://www.instagram.com/marcos.schiripa/" });
  assert.equal(site.facebook, null, "Facebook só com URL confirmada");
  assert.match(site.siteUrl, /^https:\/\//);
  assert.equal(site.messages.documentacao, "Olá, Marcos! Tenho interesse em um terreno e gostaria de saber mais sobre a documentação.");
  assert.equal(site.messages.anunciar, undefined, "a chamada para vender o imóvel foi retirada");
});

test("nenhuma página tem o e-mail antigo nem dados não confirmados", async () => {
  for (const page of PAGES) {
    const src = await read(page);
    assert.doesNotMatch(src, /crecisp|gov\.br\/?"/i, page);
    for (const banned of [/CNPJ/, /\bCPF\b/, /raz[ãa]o social/i, /encarregad/i, /\bDPO\b/, /facebook\.com/i, /localhost/]) assert.doesNotMatch(src, banned, `${page}: ${banned}`);
  }
});

test("páginas sincronizadas com a configuração (rodar npm run build se falhar)", async () => {
  for (const page of PAGES) {
    const src = await read(page);
    assert.equal(syncContacts(src), src, `${page} desatualizada`);
  }
});

test("cada botão de WhatsApp abre wa.me com a mensagem da sua seção, em nova aba", () => {
  const expected = { "header-cta": "home", "hero-cta2": "home", "mmenu-cta": "menu", "doc-cta": "documentacao", "band-cta": "visita" };
  const links = tags(html, /<a\b[^>]*\sdata-wa="[^"]*"[^>]*>/g);
  for (const tag of links) {
    const key = tag.match(/data-wa="([^"]*)"/)[1];
    assert.ok(key === "" || site.messages[key], `mensagem ausente: ${key}`);
    assert.equal(decode(tag.match(/href="([^"]+)"/)[1]), waLink(site.whatsappNumber, site.messages[key]));
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
  for (const [cls, key] of Object.entries(expected)) {
    const tag = links.find((t) => t.includes(cls));
    assert.ok(tag, cls);
    assert.match(tag, new RegExp(`data-wa="${key}"`), cls);
  }
  assert.match(html, /class="btn btn-red btn-glow btn-serif hero-cta[^"]*"[^>]*href="#imoveis">Explorar imóveis/);
});

test("hero, seções, menus e âncoras do novo conteúdo", () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.deepEqual([...html.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map((m) => m[1]), ["inicio", "imoveis", "documentacao", "sobre", "contato"]);
  assert.match(html, />Imóveis em Atibaia e região</);
  assert.match(html, /<span class="line">Seu próximo capítulo<\/span>\s*<span class="line">começa no<\/span>\s*<span class="line accent"><span class="underline">imóvel certo\.<\/span><\/span>/);
  assert.match(html, /Terrenos, casas, apartamentos, chácaras e sítios em Atibaia e região, com atendimento direto de Marcos Schiripa\./);
  assert.match(html, /Corretor independente<span class="trust-sep"> • <\/span><span data-site="creci">CRECI 330533\/SP<\/span>/);
  const nav = [...html.matchAll(/class="nav-link" href="(#[a-z]+)"[^>]*>([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(nav, ["#inicio Início", "#imoveis Imóveis", "#sobre Sobre Marcos", "#contato Contato"]);
  assert.match(html, /<span class="nav-indicador" aria-hidden="true"><\/span>/);
  const mob = [...html.matchAll(/class="menu-link" href="(#[a-z]+)"[^>]*>.*?<span>([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(mob, nav);
  assert.doesNotMatch(html.match(/<section class="section hero"[\s\S]*?<\/section>/)[0], /documentação/i, "a hero não estende a documentação de terrenos a todos os imóveis");
});

test("Documentação: a seção da primeira versão, restaurada como estava", () => {
  const doc = html.match(/<section class="section documentacao" id="documentacao"[\s\S]*?<\/section>/)[0];
  assert.match(doc, /<span class="num">02<\/span> \/ Documentação/);
  assert.match(doc, />Compra com clareza</);
  assert.match(doc, /<span class="line">Seu sonho merece<\/span> <span class="line accent">uma base segura\.<\/span>/);
  assert.match(doc, />Trabalhamos somente com terrenos com documentação\.</);
  assert.match(doc, /documentacao-montagem-884\.webp/);
  assert.match(doc, /documentacao-mobile-853\.webp/);
  const passos = [...doc.matchAll(/<span class="step-num"[^>]*>(\d\d)<\/span><div><h3>([^<]+)<\/h3>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(passos, ["01 Conheça os terrenos", "02 Confira a documentação", "03 Tire suas dúvidas"]);
  assert.match(doc, /class="btn btn-red doc-cta"[^>]*data-wa="documentacao"[^>]*>Conversar com a Renovato/);
});

test("menu mobile: uma instância fora do cabeçalho, dois blocos e o botão de contato", () => {
  assert.equal((html.match(/class="mmenu"/g) || []).length, 1);
  const panel = html.match(/<div class="mmenu"[\s\S]*?<\/nav>\s*<\/div>\s*<\/div>/)[0];
  assert.ok(html.indexOf("</header>") < html.indexOf('<div class="mmenu"'));
  assert.match(panel, /role="dialog" aria-modal="true" aria-label="Menu" hidden/);
  assert.match(panel, /<button class="mmenu-close" type="button" aria-label="Fechar menu"/);
  assert.equal((panel.match(/class="mmenu-card /g) || []).length, 2);
  assert.match(panel, /class="mmenu-cta"[^>]*data-wa="menu"[^>]*>[\s\S]*?Falar com Marcos<\/a>/);
});

test("Sobre Marcos com os textos confirmados, sem a chamada para vender o imóvel", () => {
  assert.doesNotMatch(html, /Quer vender seu imóvel|Quero anunciar meu imóvel|class="captacao/);
  assert.match(html, /Atendimento direto para encontrar<\/span> <span class="line accent">seu próximo imóvel\./);
  assert.match(html, /Sou <span data-site="ownerFullName">Marcos Roberto Schiripa<\/span>, corretor de imóveis independente, inscrito no <span data-site="creci">CRECI 330533\/SP<\/span>\. Atuo em Atibaia e região com terrenos, casas, apartamentos, chácaras e sítios, conectando proprietários e pessoas que procuram seu próximo imóvel\./);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/marcos\.schiripa\/" data-contact="instagram"[^>]*>@marcos\.schiripa</);
});

test("FAQ: seis perguntas do briefing, acordeões com aria-controls válidos", () => {
  const buttons = [...html.matchAll(/<button class="faq-q"[^>]*aria-expanded="(true|false)" aria-controls="([^"]+)">([^<]+)</g)];
  assert.deepEqual(buttons.map((b) => b[3]), ["Quais tipos de imóveis você trabalha?", "Em qual região você atende?", "Como posso consultar os valores?", "Como agendo uma visita?", "Posso anunciar meu imóvel?", "Como consulto a documentação?"]);
  assert.deepEqual(buttons.map((b) => b[1]), ["true", "true", "false", "false", "false", "false"]);
  for (const [, , id] of buttons) assert.match(html, new RegExp(`id="${id}"`));
});

test("rodapé: marca, nome, atuação, CRECI, região, contatos, Instagram e política", () => {
  const footer = html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  for (const t of [">Renovato Imóveis<", ">Marcos Roberto Schiripa<", ">Corretor de imóveis independente<", ">CRECI 330533/SP<", ">Atibaia e região<"]) assert.ok(footer.includes(t), t);
  assert.match(footer, /WhatsApp: <a[^>]*href="https:\/\/wa\.me\/5511925993517"[^>]*>\+55 11 92599-3517<\/a>/);
  assert.match(footer, /href="tel:\+5511925993517"/);
  assert.match(footer, /E-mail: <a[^>]*href="mailto:marcos\.schiripa@creci\.org\.br"[^>]*>marcos\.schiripa@creci\.org\.br<\/a>/);
  assert.match(footer, /Instagram: <a href="https:\/\/www\.instagram\.com\/marcos\.schiripa\/"/);
  assert.match(footer, /href="politica-de-privacidade\/">Política de Privacidade</);
});

test("anúncios: só os publicados e completos; terreno sem cômodos; preço ausente nunca vira zero", () => {
  const problemas = [];
  const lista = publicados(FIXTURE, problemas);
  assert.deepEqual(lista.map((im) => im.id), ["casa-a", "terreno-b", "apto-c"]);
  assert.match(problemas.join(), /sem-foto: falta fotos/);
  const terreno = lista[1];
  assert.equal(terreno.quartos, null);
  assert.equal(terreno.vagas, null);
  assert.deepEqual(caracteristicasResumo(terreno), ["Área do terreno: 450 m²"]);
  assert.deepEqual(caracteristicasResumo(lista[0]), ["Área construída: 150 m²", "3 quartos", "2 banheiros", "2 vagas"]);
  assert.equal(formatarPreco(terreno.preco), "Valor sob consulta");
  assert.equal(formatarPreco(lista[2].preco), "Valor sob consulta", "preço 0 é tratado como ausente");
  assert.equal(formatarPreco(500000), "R$ 500.000");
});

test("busca: localidade, valor máximo e área mínima combinados; sem preço/área nunca entram; validação", () => {
  assert.deepEqual(ORCAMENTO, { min: 0, max: 270000, passo: 1000 });
  const t = (id, preco, m2, bairro = "Centro", cidade = "Atibaia", rotulo = "Área do terreno") => ({ id, tipo: "Terreno", preco, bairro, cidade, areas: m2 ? [{ rotulo, m2 }] : [] });
  const lista = [
    t("a", 270000, 264, "Jardim Bonança", "Bragança Paulista"),
    t("b", 170000, 314, "Jardim São João", "Joanópolis", "Área total"),
    t("c", null, 500),
    t("d", 300000, 400),
    t("e", 150000, null),
    t("f", 120000, 600, "Centro", "Atibaia", "Área construída"),
    { id: "casa", tipo: "Casa", preco: 100000, bairro: "Centro", cidade: "Atibaia", areas: [] },
  ];
  const ids = (f) => filtrarTerrenos(lista, f).map((i) => i.id).join(",");
  assert.equal(ids({}), "a,b,e,f", "padrão: só terrenos com preço até R$ 270.000");
  assert.equal(ids({ max: 270000 }), "a,b,e,f", "preço igual ao teto entra");
  assert.equal(ids({ max: 170000 }), "b,e,f");
  assert.equal(ids({ max: 0 }), "", "o mínimo da escala não é preço de anúncio");
  assert.equal(ids({ local: "Jardim Bonança|Bragança Paulista" }), "a");
  assert.equal(ids({ areaMin: 300 }), "b", "sem área e área construída não contam como área do terreno");
  assert.equal(ids({ areaMin: 264 }), "a,b", "área igual à mínima entra");
  assert.equal(ids({ local: "Jardim São João|Joanópolis", max: 170000, areaMin: 314 }), "b");
  assert.equal(ids({ local: "Jardim São João|Joanópolis", max: 169000 }), "");
  assert.deepEqual(opcoesLocal(lista).map((o) => o.rotulo), ["Centro — Atibaia", "Jardim Bonança — Bragança Paulista", "Jardim São João — Joanópolis"]);
  assert.deepEqual(opcoesArea(lista), [264, 314, 400, 500]);
  assert.equal(areaTerreno(lista[5]), null);
  assert.deepEqual(validarValor("270.000"), { valor: 270000, aviso: "" });
  assert.equal(validarValor("300000").valor, 270000, "acima do teto vira o teto");
  assert.match(validarValor("300000").aviso, /máximo da busca é R\$ 270\.000/);
  for (const ruim of ["-5", "abc", ""]) assert.equal(validarValor(ruim).valor, null, ruim);
  assert.deepEqual(validarArea(""), { valor: null, aviso: "" });
  assert.equal(validarArea("280").valor, 280);
  for (const ruim of ["0", "2a"]) assert.equal(validarArea(ruim).valor, undefined, ruim);
  assert.equal(textoArea(264), "A partir de 264 m²");
  assert.deepEqual(foraDoOrcamento(lista).map((i) => i.id), ["c", "d"]);
  assert.equal(contagemTerrenos(2), "2 terrenos encontrados");
  assert.equal(contagemTerrenos(1), "1 terreno encontrado");
  assert.equal(contagemTerrenos(0), "Nenhum terreno encontrado");
  assert.equal(textoOrcamento(270000), "Até R$ 270.000");
  assert.equal(textoOrcamento(0), "Até R$ 0");
});

test("terrenos reais: dois publicados, preços dentro do teto, fotos separadas por anúncio", async () => {
  const lista = publicados(JSON.parse(await read("data/imoveis.json")));
  assert.deepEqual(lista.map((i) => [i.titulo, i.preco, i.areas[0].m2, i.fotos.length]), [
    ["Terreno em Bragança Paulista", 270000, 264, 4],
    ["Terreno em Joanópolis/SP", 170000, 314, 4],
  ]);
  assert.deepEqual(foraDoOrcamento(lista), []);
  for (const im of lista) for (const f of im.fotos) assert.ok(f.arquivo.includes(`/${im.id}/`) && f.miniatura.includes(`/${im.id}/`), `foto fora da pasta do anúncio: ${f.arquivo}`);
  const todas = lista.flatMap((i) => i.fotos.map((f) => f.arquivo));
  assert.equal(new Set(todas).size, todas.length, "foto repetida");
  assert.equal(mensagemConhecer(lista[0]), `Olá, Marcos! Vi o terreno em Bragança Paulista, no bairro Jardim Bonança, no site da Renovato Imóveis. Gostaria de receber mais informações e combinar uma visita.\n${site.siteUrl}/imovel/?id=terreno-braganca-jardim-bonanca`);
  assert.equal(mensagemConhecer(lista[1]), `Olá, Marcos! Vi o terreno em Joanópolis/SP, no bairro Jardim São João, no site da Renovato Imóveis. Gostaria de receber mais informações e combinar uma visita.\n${site.siteUrl}/imovel/?id=terreno-joanopolis-jardim-sao-joao`);
  assert.equal(mensagemConhecer({ ...lista[0], referencia: "T-9", titulo: "Lote no alto" }).split("\n")[0], "Olá, Marcos! Vi o terreno “Lote no alto”, referência T-9, em Jardim Bonança, Bragança Paulista, no site da Renovato Imóveis. Gostaria de receber mais informações e combinar uma visita.");
});

test("mensagens por imóvel: só campos existentes, link público, sem variáveis soltas", () => {
  const [casa, terreno, apto] = publicados(FIXTURE);
  assert.equal(mensagemInteresse(casa), `Olá, Marcos! Tenho interesse no imóvel Casa A, referência T-1, em Centro, Atibaia. Gostaria de receber mais informações.\n${site.siteUrl}/imovel/?id=casa-a`);
  assert.equal(mensagemInteresse(apto), `Olá, Marcos! Tenho interesse no imóvel Apartamento C, em Atibaia. Gostaria de receber mais informações.\n${site.siteUrl}/imovel/?id=apto-c`);
  assert.match(mensagemVisita(terreno), /^Olá, Marcos! Gostaria de agendar uma visita ao imóvel Terreno B, referência T-2, em Piracaia\.\n/);
  for (const m of [mensagemInteresse(casa), mensagemInteresse(apto), mensagemVisita(terreno)]) assert.doesNotMatch(m, /\[|\]|undefined|null|localhost/);
});

test("compartilhamento, sitemap, robots e 404 apontam para o endereço configurado", async () => {
  for (const [nome, src] of [["index", html], ["detalhe", detalhe], ["política", policy]]) {
    const absolutos = tags(src, /<(meta|link)\b[^>]*\sdata-url="[^"]*"[^>]*>/g);
    assert.ok(absolutos.length, `${nome}: sem tags de compartilhamento`);
    for (const t of absolutos) assert.match(t, new RegExp(`(content|href)="${site.siteUrl.replace(/[.]/g, "\\.")}/`), t);
    assert.match(src, /<meta property="og:image" content="[^"]+\/assets\/img\/compartilhar\.jpg"/);
  }
  await stat(new URL("../assets/img/compartilhar.jpg", import.meta.url));
  await stat(new URL("../assets/img/icone-180.png", import.meta.url));
  const dados = JSON.parse(await read("data/imoveis.json"));
  assert.equal(await read("sitemap.xml"), sitemap(dados), "sitemap.xml desatualizado (rodar npm run build)");
  assert.equal(await read("robots.txt"), robots());
  const comAnuncio = sitemap(FIXTURE);
  assert.match(comAnuncio, new RegExp(`<loc>${site.siteUrl}/imovel/\\?id=casa-a</loc>`));
  assert.doesNotMatch(comAnuncio, /rascunho|sem-foto/, "só anúncios publicados e completos entram no sitemap");
  assert.match(pagina404, /<title>Página não encontrada — Renovato Imóveis<\/title>/);
  assert.match(pagina404, /<meta name="robots" content="noindex">/);
  assert.match(pagina404, /href="\/#imoveis"/);
});

test("data/imoveis.json: válido, sem anúncios incompletos publicados, fotos existentes", async () => {
  const dados = JSON.parse(await read("data/imoveis.json"));
  assert.ok(Array.isArray(dados.imoveis));
  const problemas = [];
  const lista = publicados(dados, problemas);
  assert.deepEqual(problemas, [], "anúncio marcado como publicado sem informação mínima");
  for (const im of lista) for (const f of im.fotos) for (const arq of [f.arquivo, f.miniatura]) await stat(new URL(`../${arq}`, import.meta.url));
});

test("política: responsável, CRECI, contatos atualizados, data da versão e sem termos proibidos", () => {
  assert.match(policy, /<title>Política de Privacidade — Renovato Imóveis<\/title>/);
  assert.equal((policy.match(/<h1\b/g) || []).length, 1);
  assert.match(policy, new RegExp(`<time datetime="${site.policyVersion}">28 de outubro de 2026</time>`));
  assert.match(policy, /mantido por <strong data-site="ownerFullName">Marcos Roberto Schiripa<\/strong>, corretor de imóveis independente, inscrito no <span data-site="creci">CRECI 330533\/SP<\/span>/);
  assert.match(policy, /mailto:marcos\.schiripa@creci\.org\.br/);
  assert.match(policy, /tel:\+5511925993517[^>]*>Ligar para \+55 11 92599-3517</);
  assert.match(policy, /https:\/\/wa\.me\/5511925993517/);
  assert.match(policy, /instagram\.com\/marcos\.schiripa/);
  assert.match(policy, /armazenamento local/);
  assert.match(policy, /filtros[^.]*funcionam inteiramente no navegador/);
  for (const banned of [/ao navegar[^.]*concorda/i, /segurança (total|absoluta)/i, /verificad[oa]/i]) assert.doesNotMatch(policy, banned, String(banned));
});

test("estrutura: sem formulários de envio; campos só nos filtros do catálogo", () => {
  for (const src of [html, detalhe, policy]) assert.doesNotMatch(src, /<form|<textarea|type="(email|tel|password|file)"/);
  const busca = html.match(/<div class="busca" role="search"[\s\S]*?data-pendente><\/p>\s*<\/div>/)[0];
  assert.equal(tags(html, /<(input|select)\b/g).length, tags(busca, /<(input|select)\b/g).length, "campos fora da busca");
  for (const [rotulo, valor] of [["Localidade", "Todos os locais"], ["Valor máximo", "Até R\\$ 270\\.000"], ["Área mínima", "Qualquer área"]]) {
    assert.match(busca, new RegExp(`<span class="busca-rotulo">${rotulo}</span><span class="busca-valor"[^>]*>${valor}</span>`));
  }
  assert.match(busca, /<input class="orcamento-range" id="f-orcamento" type="range" min="0" max="270000" step="1000" value="270000"/);
  for (const id of ["f-valor", "f-area"]) assert.match(busca, new RegExp(`<label class="painel-label" for="${id}">`));
  assert.match(busca, /data-buscar><svg[^>]*><use href="#i-lupa"\/><\/svg> Buscar terrenos<\/button>/);
  assert.equal((busca.match(/aria-expanded="false" aria-controls="painel-/g) || []).length, 3);
  assert.match(html, />Nenhum terreno encontrado com esses critérios\.</);
  assert.match(html, /<p class="eyebrow imoveis-eyebrow">Encontre seu espaço<\/p>/);
  assert.match(html, />Qual terreno <span class="accent">combina com você\?<\/span></);
  assert.match(html, />Explore as opções disponíveis e encontre o terreno que faz sentido para seus planos\.</);
  assert.doesNotMatch(busca, /quarto|banheiro|vaga/i, "sem filtros que não fazem sentido para terrenos");
});

test("imagens: todas com dimensões, alt e arquivo existente", async () => {
  for (const [src, base] of [[html, "../"], [detalhe, "../imovel/"], [policy, "../politica-de-privacidade/"], [pagina404, "../"]]) {
    // (a foto da janela ampliada não tem src no HTML: é preenchida ao abrir)
    for (const tag of tags(src, /<img\b[^>]*>/g).filter((t) => / src="/.test(t))) {
      assert.match(tag, /width="\d+"/, tag);
      assert.match(tag, /height="\d+"/, tag);
      assert.match(tag, /alt="/, tag);
      await stat(new URL(base + tag.match(/src="([^"]+)"/)[1].replace(/^\//, ""), import.meta.url));
    }
  }
  for (const [, src] of html.matchAll(/(assets\/img\/[^\s"]+\.webp)/g)) await stat(new URL(`../${src}`, import.meta.url));
});

test("sem scripts inline, scripts externos, pixels ou fontes de terceiros; CSP presente", () => {
  for (const src of [html, detalhe, policy, pagina404]) {
    assert.doesNotMatch(src, /<script(?![^>]*\ssrc=)[^>]*>/, "script inline (bloqueado pela CSP)");
    assert.doesNotMatch(src, /<script[^>]+src="https?:/);
    // estilos, fontes e ícones só do próprio site (o canonical aponta para o endereço público do site)
    assert.doesNotMatch(src, /<link\b(?=[^>]*rel="(stylesheet|preload|modulepreload|icon|apple-touch-icon)")[^>]*href="https?:/);
    assert.doesNotMatch(src, /fonts\.googleapis|googletagmanager|facebook\.net|gtag\(|fbq\(/);
    assert.match(src, /http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';/);
  }
});
