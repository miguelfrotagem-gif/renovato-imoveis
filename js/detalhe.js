// Página de detalhes: imovel/?id=<id do anúncio em data/imoveis.json>
import { site } from "./config.js";
import { waLink } from "./whatsapp.js";
import { carregarImoveis, formatarPreco, localizacao, caracteristicasResumo, urlFoto, linkInteresse, linkVisita } from "./imoveis.js";

window.__renovatoReady = true;

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const reducedMQ = matchMedia("(prefers-reduced-motion: reduce)");
const main = $("[data-detalhe]");

// elemento com atributos e filhos (texto sempre por textContent: nada do arquivo vira HTML)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}
const icon = (id, cls = "icon") => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
};
const waAttrs = (href) => (href ? { href, target: "_blank", rel: "noopener noreferrer" } : { href: "../#contato" });

for (const a of document.querySelectorAll("[data-wa]")) Object.assign(a, waAttrs(waLink(site.whatsappNumber, site.messages[a.dataset.wa])));

function galeria(fotos, titulo) {
  const n = fotos.length;
  const trilha = el("div", { class: "galeria-trilha", tabindex: "0", "aria-label": n > 1 ? "Fotos do imóvel. Use as setas do teclado para trocar de foto." : "Foto do imóvel" });
  fotos.forEach((f, i) =>
    trilha.append(el("figure", { class: "galeria-foto", role: "group", "aria-roledescription": "foto", "aria-label": `${i + 1} de ${n}` }, el("img", { src: urlFoto(f.arquivo), alt: f.alt, loading: i ? "lazy" : "eager", decoding: "async" })))
  );
  const box = el("section", { class: "galeria", "aria-roledescription": "galeria", "aria-label": `Fotos: ${titulo}` }, el("div", { class: "galeria-palco" }, trilha));
  const original = el("a", { class: "galeria-original", href: urlFoto(fotos[0].arquivo), target: "_blank", rel: "noopener" }, icon("i-ampliar"), "Abrir foto inteira");
  if (n === 1) {
    box.append(el("div", { class: "galeria-barra" }, original));
    return box;
  }
  const ant = el("button", { class: "galeria-seta galeria-ant", type: "button", "aria-label": "Foto anterior" }, icon("i-ant"));
  const prox = el("button", { class: "galeria-seta galeria-prox", type: "button", "aria-label": "Próxima foto" }, icon("i-prox"));
  const contador = el("p", { class: "galeria-contador", "aria-live": "polite" }, `1 / ${n}`);
  const miniaturas = el("div", { class: "galeria-miniaturas" });
  const minis = fotos.map((f, i) => {
    const b = el("button", { type: "button", class: "galeria-mini", "aria-label": `Ver foto ${i + 1}: ${f.alt}` }, el("img", { src: urlFoto(f.miniatura), alt: "", loading: "lazy", decoding: "async" }));
    b.addEventListener("click", () => ir(i));
    miniaturas.append(b);
    return b;
  });
  $(".galeria-palco", box).append(ant, prox);
  box.append(el("div", { class: "galeria-barra" }, contador, original), miniaturas);

  let atual = 0;
  function marcar(i) {
    atual = i;
    contador.textContent = `${i + 1} / ${n}`;
    ant.disabled = i === 0;
    prox.disabled = i === n - 1;
    original.href = urlFoto(fotos[i].arquivo);
    minis.forEach((b, j) => (j === i ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
  }
  function ir(i) {
    const alvo = Math.max(0, Math.min(n - 1, i));
    trilha.scrollTo({ left: alvo * trilha.clientWidth, behavior: reducedMQ.matches ? "auto" : "smooth" });
    marcar(alvo);
  }
  ant.addEventListener("click", () => ir(atual - 1));
  prox.addEventListener("click", () => ir(atual + 1));
  trilha.addEventListener("keydown", (ev) => {
    const mapa = { ArrowLeft: atual - 1, ArrowRight: atual + 1, Home: 0, End: n - 1 };
    if (!(ev.key in mapa)) return;
    ev.preventDefault();
    ir(mapa[ev.key]);
  });
  // deslizar no celular (scroll-snap) também atualiza contador e botões
  let tick = false;
  trilha.addEventListener("scroll", () => {
    if (tick) return;
    tick = true;
    requestAnimationFrame(() => {
      tick = false;
      const i = Math.round(trilha.scrollLeft / trilha.clientWidth);
      if (i !== atual) marcar(i);
    });
  }, { passive: true });
  addEventListener("resize", () => trilha.scrollTo({ left: atual * trilha.clientWidth }), { passive: true });
  marcar(0);
  return box;
}

function naoEncontrado() {
  document.title = "Imóvel não encontrado — Renovato Imóveis";
  main.replaceChildren(
    el("div", { class: "det-estado" },
      el("h1", { class: "display det-estado-titulo" }, "Imóvel não encontrado"),
      el("p", {}, "Este anúncio não está disponível. Veja os imóveis publicados ou fale com Marcos."),
      el("div", { class: "det-acoes" },
        el("a", { class: "btn btn-red btn-serif", href: "../#imoveis" }, "Ver imóveis"),
        el("a", { class: "btn btn-ghost", ...waAttrs(waLink(site.whatsappNumber, site.messages.imoveis)) }, icon("i-wa"), " Falar com Marcos")))
  );
}

function mostrar(im) {
  document.title = `${im.titulo} — Renovato Imóveis`;
  const local = localizacao(im);
  const resumo = caracteristicasResumo(im);
  const descricao = im.descricao ? im.descricao.split(/\n{2,}/).map((p) => el("p", {}, p)) : [];
  const info = el("div", { class: "det-info" },
    el("p", { class: "det-tipo" }, im.tipo),
    el("h1", { class: "display det-titulo" }, im.titulo),
    local ? el("p", { class: "det-local" }, local) : null,
    el("p", { class: `det-preco${im.preco === null ? " is-consulta" : ""}` }, formatarPreco(im.preco)),
    resumo.length ? el("ul", { class: "det-resumo", "aria-label": "Características principais" }, ...resumo.map((r) => el("li", {}, r))) : null,
    el("div", { class: "det-acoes" },
      el("a", { class: "btn btn-red btn-serif", ...waAttrs(linkVisita(im)), "data-det-visita": true }, icon("i-calendario"), " Agendar visita"),
      el("a", { class: "btn btn-ghost", ...waAttrs(linkInteresse(im)), "data-det-interesse": true }, icon("i-wa"), " Pedir mais informações")),
    descricao.length ? el("section", { class: "det-bloco", "aria-labelledby": "det-desc" }, el("h2", { id: "det-desc" }, "Descrição"), ...descricao) : null,
    im.caracteristicas.length ? el("section", { class: "det-bloco", "aria-labelledby": "det-carac" }, el("h2", { id: "det-carac" }, "Características"), el("ul", { class: "det-lista" }, ...im.caracteristicas.map((c) => el("li", {}, c)))) : null,
    im.referencia ? el("p", { class: "det-ref" }, `Referência do anúncio: ${im.referencia}`) : null
  );
  main.replaceChildren(el("article", { class: "det" }, galeria(im.fotos, im.titulo), info));
}

const id = new URLSearchParams(location.search).get("id");
carregarImoveis()
  .then((lista) => {
    const im = lista.find((x) => x.id === id);
    im ? mostrar(im) : naoEncontrado();
  })
  .catch((err) => {
    console.error(err);
    $("[data-det-status]").textContent = "Não foi possível carregar este anúncio agora. Fale com Marcos pelo WhatsApp.";
  });
