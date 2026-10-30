import { site } from "./config.js";
import { waLink } from "./whatsapp.js";
import { carregarImoveis, ORCAMENTO, BUSCA_PADRAO, terrenos, filtrarTerrenos, opcoesLocal, opcoesArea, validarValor, validarArea, foraDoOrcamento, contagemTerrenos, textoOrcamento, textoArea, formatarPreco, localizacao, urlFoto, urlDetalhes, linkConhecer } from "./imoveis.js";

window.__renovatoReady = true;

const root = document.documentElement;
const desktopMQ = matchMedia("(min-width: 900px) and (min-aspect-ratio: 5/4)");
const reducedMQ = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ---------- aviso acessível ----------
const toast = $("[data-toast]");
let toastTimer;
function showToast(message) {
  toast.textContent = "";
  toast.classList.add("is-visible");
  requestAnimationFrame(() => (toast.textContent = message)); // reanuncia mesmo se o texto repetir
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 6000);
}

// ---------- WhatsApp ----------
function ligarWhatsApp(link, href) {
  if (href) {
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  } else {
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      closeMenu(false);
      showToast(site.fallbackMessage);
    });
  }
}
for (const link of $$("[data-wa]")) ligarWhatsApp(link, waLink(site.whatsappNumber, site.messages[link.dataset.wa]));

// ---------- abertura (logo + nome) ----------
// boot.js decide se ela aparece; aqui ela termina sozinha, por toque ou por tecla, e libera a entrada do site.
const intro = $("[data-intro]");
const introPronta = new Promise((resolve) => {
  if (!intro || !root.classList.contains("com-abertura")) return resolve();
  const encerrar = () => {
    root.classList.remove("com-abertura");
    removeEventListener("keydown", pular);
    resolve();
  };
  const pular = () => intro.classList.add("is-pulando");
  // só a saída encerra (o brilho do ::before também dispara animationend no próprio elemento)
  intro.addEventListener("animationend", (ev) => ev.target === intro && ev.animationName === "intro-sai" && encerrar());
  intro.addEventListener("click", pular);
  addEventListener("keydown", pular);
  setTimeout(encerrar, 3600); // segurança caso o evento de animação não chegue
});

// ---------- aviso de privacidade ----------
// Mostra uma vez por versão da política. O registro local só controla a exibição do aviso:
// não é consentimento para publicidade nem ativa nada além disso.
const notice = $("[data-privacy]");
const NOTICE_KEY = "renovato-aviso-privacidade";
let noticeClosed = false; // vale para a página atual mesmo sem armazenamento disponível

function noticeSeen() {
  try {
    if (sessionStorage.getItem(NOTICE_KEY) === site.policyVersion) return true;
  } catch {}
  try {
    return JSON.parse(localStorage.getItem(NOTICE_KEY))?.versao === site.policyVersion;
  } catch {
    return false;
  }
}
function showNotice() {
  if (!notice || noticeClosed || noticeSeen()) return;
  notice.hidden = false;
  notice.offsetWidth; // aplica o estado inicial antes da transição
  notice.classList.add("is-visible");
}
function hideNotice() {
  noticeClosed = true;
  const hadFocus = notice.contains(document.activeElement);
  notice.classList.remove("is-visible");
  setTimeout(() => (notice.hidden = true), reducedMQ.matches ? 0 : 260);
  if (hadFocus) $(".brand").focus({ preventScroll: true });
}
if (notice) {
  $("[data-privacy-accept]", notice).addEventListener("click", () => {
    try {
      localStorage.setItem(NOTICE_KEY, JSON.stringify({ versao: site.policyVersion, data: new Date().toISOString() }));
    } catch {}
    hideNotice();
  });
  // "Agora não" e o X: sem registro de aceite; não volta nesta sessão
  for (const btn of $$("[data-privacy-dismiss]", notice)) {
    btn.addEventListener("click", () => {
      try {
        sessionStorage.setItem(NOTICE_KEY, site.policyVersion);
      } catch {}
      hideNotice();
    });
  }
  const later = () => introPronta.then(() => setTimeout(showNotice, 800)); // nunca por cima da abertura
  if (document.readyState === "complete") later();
  else addEventListener("load", later, { once: true });
}

// ---------- menu mobile: painel de tela inteira ----------
const header = $("[data-header]");
const menuToggle = $("[data-menu-toggle]");
const panel = $("[data-mmenu]");
const panelClose = $("[data-menu-close]");
const behind = [header, $("main"), $(".site-footer"), $(".skip-link"), notice].filter(Boolean);
let lockedY = 0;
let hideTimer;

const isMenuOpen = () => menuToggle.getAttribute("aria-expanded") === "true";
// trava a página ao fundo sem perder a posição (body fixo, deslocado pela rolagem atual)
function lockScroll() {
  lockedY = scrollY;
  Object.assign(document.body.style, { position: "fixed", top: `-${lockedY}px`, left: "0", right: "0", width: "100%" });
}
function unlockScroll() {
  Object.assign(document.body.style, { position: "", top: "", left: "", right: "", width: "" });
  scrollTo({ top: lockedY, behavior: "instant" });
}
function openMenu() {
  if (isMenuOpen()) return;
  clearTimeout(hideTimer);
  menuToggle.setAttribute("aria-expanded", "true");
  lockScroll();
  panel.hidden = false;
  $(".mmenu-scroll", panel).scrollTop = 0;
  behind.forEach((el) => (el.inert = true));
  panel.offsetWidth;
  panel.classList.add("is-open");
  panelClose.focus({ preventScroll: true });
}
function closeMenu(returnFocus = true) {
  if (!isMenuOpen()) return;
  menuToggle.setAttribute("aria-expanded", "false");
  panel.classList.remove("is-open"); // sem pointer-events desde já: nada invisível bloqueia a página
  behind.forEach((el) => (el.inert = false));
  unlockScroll();
  if (returnFocus) menuToggle.focus({ preventScroll: true });
  hideTimer = setTimeout(() => (panel.hidden = true), reducedMQ.matches ? 0 : 200);
}
menuToggle.addEventListener("click", openMenu);
panelClose.addEventListener("click", () => closeMenu());
// toque na camada clara (fora dos dois blocos brancos) fecha; dentro dos blocos, não
$("[data-mmenu-backdrop]", panel).addEventListener("click", (ev) => {
  if (ev.target === ev.currentTarget) closeMenu();
});
panel.addEventListener("click", (ev) => {
  const link = ev.target.closest("a");
  if (!link) return;
  if (!link.matches("[data-mmenu-link]")) {
    // WhatsApp (nova aba) ou política: o menu não fica aberto por trás
    if (link.target === "_blank") setTimeout(() => closeMenu(false), 0);
    return;
  }
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;
  ev.preventDefault();
  closeMenu();
  if (location.hash !== link.hash) history.pushState(null, "", link.hash);
  target.scrollIntoView({ behavior: reducedMQ.matches ? "auto" : "smooth", block: "start" });
  setActive(target.id);
});
// foco contido no painel aberto
panel.addEventListener("keydown", (ev) => {
  if (ev.key !== "Tab") return;
  const items = $$("a[href], button", panel);
  const first = items[0];
  const last = items.at(-1);
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeMenu();
});
desktopMQ.addEventListener("change", () => closeMenu(false));
addEventListener("pagehide", () => closeMenu(false));

// ---------- cabeçalho: compacto ao rolar; no desktop some ao descer e volta ao subir ----------
let lastY = scrollY;
function onScrollHeader() {
  const y = scrollY;
  header.classList.toggle("is-scrolled", y > 24);
  const goingDown = y > lastY + 4;
  const goingUp = y < lastY - 4;
  if (!desktopMQ.matches || y < 120 || header.matches(":focus-within")) header.classList.remove("is-hidden");
  else if (goingDown) header.classList.add("is-hidden");
  else if (goingUp) header.classList.remove("is-hidden");
  if (goingDown || goingUp) lastY = y;
}
header.addEventListener("focusin", () => header.classList.remove("is-hidden"));
// ponteiro no topo da janela também traz o menu de volta
addEventListener("mousemove", (ev) => {
  if (ev.clientY < 72 && header.classList.contains("is-hidden")) header.classList.remove("is-hidden");
}, { passive: true });

// ---------- opção ativa do menu ----------
const navLinks = $$(".nav-link, .menu-link");
const navIds = new Set(navLinks.map((a) => a.hash.slice(1)));
const indicador = $(".nav-indicador");
// sublinhado vermelho do menu desktop: desliza até a opção ativa (hover e foco têm estilos próprios)
function moverIndicador() {
  const ativo = $(".nav-link[aria-current]");
  if (!indicador || !ativo || !desktopMQ.matches) return;
  const base = indicador.parentElement.getBoundingClientRect();
  const r = ativo.getBoundingClientRect();
  indicador.style.setProperty("--x", `${(r.left - base.left + r.width / 2).toFixed(1)}px`);
  requestAnimationFrame(() => indicador.classList.add("is-pronto")); // sem deslizar a partir do zero na carga
}
function setActive(id) {
  for (const a of navLinks) {
    if (a.hash === `#${id}`) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
  moverIndicador();
}
// Seção ativa pela linha de leitura (cabeçalho + 30% do resto da tela), sem intervalos vazios:
// vale a última seção cujo topo já passou da linha; seções fora do menu (Documentação) contam
// como a opção anterior; no fim da página, a última opção.
const secoes = $$("main > section");
function atualizarAtivo() {
  const cab = header.classList.contains("is-hidden") ? 0 : header.offsetHeight;
  const linha = scrollY + cab + (innerHeight - cab) * 0.3;
  let atual = secoes[0].id;
  for (const s of secoes) {
    if (s.offsetTop > linha) break;
    if (navIds.has(s.id)) atual = s.id;
  }
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) atual = [...navIds].at(-1);
  setActive(atual);
}

// ---------- revelação ao entrar na tela ----------
const revealObserver = new IntersectionObserver(
  (entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.setProperty("--rd", `${Math.min(i++, 5) * 70}ms`);
      e.target.classList.add("is-in");
      revealObserver.unobserve(e.target);
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
);
$$("[data-reveal]").forEach((el) => revealObserver.observe(el));

// ---------- FAQ ----------
for (const button of $$(".faq-q")) {
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    button.closest(".faq-item").classList.toggle("is-open", open);
  });
}

// ---------- seção de terrenos: anúncios de data/imoveis.json ----------
const catalogo = $("[data-catalogo]");
const filtros = $("[data-filtros]");
const contagem = $("[data-catalogo-contagem]");
const semResultado = $("[data-catalogo-vazio]");
const aviso = $("[data-catalogo-aviso]");
const resultado = $("[data-resultado]");
const etiquetas = $("[data-etiquetas]");
const veu = $("[data-busca-veu]");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined) node.append(c); // texto do arquivo entra como texto, nunca como HTML
  return node;
}
function icone(id, cls = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

// ---------- fotos ampliadas: uma janela para todas as galerias ----------
const lb = $("[data-lightbox]");
const lbFoto = $("[data-lb-foto]", lb);
const lbAviso = $("[data-lb-aviso]", lb);
const lbMinis = $("[data-lb-miniaturas]", lb);
let lbAberto = false;
let lb_ = { fotos: [], i: 0, origem: null, aoTrocar: null };

function lbMostrar(i) {
  const { fotos } = lb_;
  const n = fotos.length;
  lb_.i = (i + n) % n;
  const f = fotos[lb_.i];
  lbAviso.hidden = true;
  lbFoto.hidden = false;
  lbFoto.src = urlFoto(f.arquivo); // mesmo arquivo da galeria: vem do cache, sem novo download
  lbFoto.alt = f.alt;
  $("[data-lb-contador]", lb).textContent = `${lb_.i + 1} de ${n}`;
  [...lbMinis.children].forEach((b, j) => (j === lb_.i ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
  lbMinis.children[lb_.i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  lb_.aoTrocar?.(lb_.i);
}
lbFoto.addEventListener("error", () => {
  lbFoto.hidden = true;
  lbAviso.hidden = false;
});
function abrirFotos(im, i, origem, aoTrocar) {
  lb_ = { fotos: im.fotos, i, origem, aoTrocar };
  const n = im.fotos.length;
  $("[data-lb-titulo]", lb).textContent = im.referencia ? `${im.titulo} · Ref. ${im.referencia}` : im.titulo;
  lb.classList.toggle("is-unica", n === 1);
  lbMinis.replaceChildren(
    ...im.fotos.map((f, j) => {
      const b = el("button", { type: "button", class: "lb-mini", "aria-label": `Foto ${j + 1} de ${n}: ${f.alt}` }, el("img", { src: urlFoto(f.miniatura), alt: "", decoding: "async" }));
      b.addEventListener("click", () => lbMostrar(j));
      return b;
    })
  );
  lbAberto = true;
  lockScroll();
  behind.forEach((e) => (e.inert = true));
  lb.hidden = false;
  lb.offsetWidth;
  lb.classList.add("is-open");
  lbMostrar(i);
  $("[data-lb-fechar]", lb).focus({ preventScroll: true });
}
function fecharFotos() {
  if (!lbAberto) return;
  lbAberto = false;
  lb.classList.remove("is-open");
  behind.forEach((e) => (e.inert = false));
  unlockScroll();
  lb_.origem?.focus({ preventScroll: true });
  setTimeout(() => !lbAberto && (lb.hidden = true), reducedMQ.matches ? 0 : 200);
}
$("[data-lb-fechar]", lb).addEventListener("click", fecharFotos);
$("[data-lb-ant]", lb).addEventListener("click", () => lbMostrar(lb_.i - 1));
$("[data-lb-prox]", lb).addEventListener("click", () => lbMostrar(lb_.i + 1));
// clique no fundo escuro (fora da foto e dos controles) fecha
$("[data-lb-palco]", lb).addEventListener("click", (ev) => ev.target === ev.currentTarget && fecharFotos());
lb.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") return fecharFotos();
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    ev.preventDefault();
    return lbMostrar(lb_.i + (ev.key === "ArrowRight" ? 1 : -1));
  }
  if (ev.key !== "Tab") return;
  const itens = $$("button", lb).filter((b) => b.getClientRects().length);
  if (ev.shiftKey && document.activeElement === itens[0]) {
    ev.preventDefault();
    itens.at(-1).focus();
  } else if (!ev.shiftKey && document.activeElement === itens.at(-1)) {
    ev.preventDefault();
    itens[0].focus();
  }
});
deslizar($("[data-lb-palco]", lb), (passo) => lbMostrar(lb_.i + passo));

// gesto horizontal (toque) para trocar de foto; a rolagem vertical continua com a página (touch-action: pan-y)
function deslizar(alvo, aoPassar) {
  let x0 = null;
  let y0 = 0;
  alvo.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse") return;
    x0 = ev.clientX;
    y0 = ev.clientY;
  });
  alvo.addEventListener("pointerup", (ev) => {
    if (x0 === null) return;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      alvo.dataset.deslizou = "1"; // um eventual clique logo após o gesto não abre a ampliação
      setTimeout(() => delete alvo.dataset.deslizou, 350);
      aoPassar(dx < 0 ? 1 : -1);
    }
  });
  alvo.addEventListener("pointercancel", () => (x0 = null));
}

// ---------- apresentação de cada anúncio: galeria própria + informações ----------
// Cada galeria guarda o próprio estado (foto atual) dentro desta função: trocar a foto de um
// anúncio nunca mexe nos outros, mesmo depois de filtrar.
function galeria(im) {
  const { fotos } = im;
  const n = fotos.length;
  let atual = 0;
  const aviso = el("p", { class: "apr-aviso", hidden: "" }, "Não foi possível carregar esta foto.");
  const imgs = fotos.map((f, i) => {
    // só a capa carrega de início; as demais quando o anúncio se aproxima da tela ou na primeira interação
    const img = el("img", { class: `apr-foto${i ? "" : " is-ativa"}`, alt: f.alt, decoding: "async", width: f.largura, height: f.altura, loading: i ? null : "lazy", "aria-hidden": i ? "true" : null });
    img.style.objectPosition = f.foco;
    if (i === 0) img.src = urlFoto(f.arquivo);
    img.addEventListener("error", () => {
      img.dataset.erro = "1";
      if (i === atual) aviso.hidden = false;
    });
    return img;
  });
  let restoCarregado = n === 1;
  function carregarResto() {
    if (restoCarregado) return;
    restoCarregado = true;
    imgs.forEach((img, i) => i && !img.src && (img.src = urlFoto(fotos[i].arquivo)));
  }
  const palco = el("div", { class: "apr-palco" }, ...imgs, aviso);
  const box = el("div", { class: "apr-galeria", "data-reveal": "fade", role: "group", "aria-roledescription": "galeria", "aria-label": `Fotos: ${im.titulo}` }, palco);
  const ampliar = el("button", { type: "button", class: "apr-ampliar" }, icone("i-ampliar"), "Ampliar fotos");
  palco.append(ampliar);
  let contador = null;
  let minis = [];
  function mostrar(i) {
    const novo = (i + n) % n;
    if (novo !== atual) {
      imgs[atual].classList.remove("is-ativa");
      imgs[atual].setAttribute("aria-hidden", "true");
      imgs[novo].classList.add("is-ativa");
      imgs[novo].removeAttribute("aria-hidden");
      atual = novo;
    }
    aviso.hidden = !imgs[atual].dataset.erro;
    if (contador) contador.textContent = `${atual + 1} de ${n}`;
    minis.forEach((b, j) => (j === atual ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
  }
  if (n > 1) {
    const ant = el("button", { type: "button", class: "apr-seta apr-ant", "aria-label": "Foto anterior" }, icone("i-ant"));
    const prox = el("button", { type: "button", class: "apr-seta apr-prox", "aria-label": "Próxima foto" }, icone("i-prox"));
    contador = el("p", { class: "apr-contador", "aria-live": "polite" }, `1 de ${n}`);
    palco.append(ant, prox, contador);
    ant.addEventListener("click", () => (carregarResto(), mostrar(atual - 1)));
    prox.addEventListener("click", () => (carregarResto(), mostrar(atual + 1)));
    minis = fotos.map((f, i) => {
      const b = el("button", { type: "button", class: "apr-mini", "aria-label": `Ver foto ${i + 1} de ${n}: ${f.alt}` }, el("img", { src: urlFoto(f.miniatura), alt: "", loading: "lazy", decoding: "async", width: 240, height: f.largura && f.altura ? Math.round((240 * f.altura) / f.largura) : null }));
      b.addEventListener("click", () => (carregarResto(), mostrar(i)));
      return b;
    });
    minis[0].setAttribute("aria-current", "true");
    box.append(el("div", { class: "apr-miniaturas" }, ...minis));
    deslizar(palco, (passo) => (carregarResto(), mostrar(atual + passo)));
    box.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      carregarResto();
      mostrar(atual + (ev.key === "ArrowRight" ? 1 : -1));
    });
    new IntersectionObserver(([e], obs) => e.isIntersecting && (carregarResto(), obs.disconnect()), { rootMargin: "300px 0px" }).observe(box);
  }
  // ampliar: abre na foto selecionada; ao fechar, a galeria fica na última foto vista
  const abrir = (origem) => abrirFotos(im, atual, origem, mostrar);
  ampliar.addEventListener("click", () => abrir(ampliar));
  palco.addEventListener("click", (ev) => {
    if (!palco.dataset.deslizou && ev.target.classList.contains("apr-foto")) abrir(ampliar);
  });
  return box;
}

function dadosApresentacao(im) {
  const item = (ic, rotulo, valor) => el("li", {}, icone(ic), el("span", { class: "apr-dado-rotulo" }, rotulo), el("span", { class: "apr-dado-valor" }, valor));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const itens = im.areas.map((a) => item("i-area", a.rotulo, `${a.m2.toLocaleString("pt-BR")} m²`));
  if (im.bairro) itens.push(item("i-local", "Bairro", im.bairro));
  if (im.quartos !== null) itens.push(item("i-cama", "Quartos", plural(im.quartos, "quarto", "quartos")));
  if (im.banheiros !== null) itens.push(item("i-banho", "Banheiros", plural(im.banheiros, "banheiro", "banheiros")));
  if (im.vagas !== null) itens.push(item("i-vaga", "Vagas", plural(im.vagas, "vaga", "vagas")));
  im.caracteristicas.forEach((c) => itens.push(el("li", {}, icone("i-check"), el("span", { class: "apr-dado-valor" }, c))));
  return itens;
}

function apresentacao(im) {
  const local = localizacao(im);
  const wa = el("a", { class: "btn btn-red apr-wa" }, icone("i-wa"), im.tipo === "Terreno" ? "Quero conhecer este terreno" : "Quero conhecer este imóvel");
  ligarWhatsApp(wa, linkConhecer(im));
  const dados = dadosApresentacao(im);
  return el("article", { class: "apr", id: `imovel-${im.id}`, "aria-labelledby": `titulo-${im.id}` },
    el("header", { class: "apr-head", "data-reveal": "" },
      el("p", { class: "apr-tipo" }, im.tipo),
      el("h3", { class: "apr-titulo", id: `titulo-${im.id}` }, im.titulo),
      local ? el("p", { class: "apr-local" }, icone("i-local"), local) : null),
    galeria(im),
    el("div", { class: "apr-info", "data-reveal": "" },
      el("p", { class: `apr-preco${im.preco === null ? " is-consulta" : ""}` }, formatarPreco(im.preco)),
      dados.length ? el("ul", { class: "apr-dados", "aria-label": "Características" }, ...dados) : null,
      im.descricao ? el("p", { class: "apr-desc" }, im.descricao) : null,
      el("div", { class: "apr-acoes" }, wa,
        el("a", { class: "link-anim apr-pagina", href: urlDetalhes(im) }, "Página do anúncio", icone("i-arrow-up", "icon icon-go"))),
      im.referencia ? el("p", { class: "apr-ref" }, `Referência: ${im.referencia}`) : null));
}

function iniciarCatalogo(publicadosTodos) {
  const lista = terrenos(publicadosTodos); // esta seção mostra só terrenos
  if (!lista.length) return; // sem terrenos publicados: fica o convite para falar com Marcos
  aviso.hidden = true;
  filtros.hidden = false;
  resultado.hidden = false;
  foraDoOrcamento(lista).forEach((im) => console.warn(`Terreno fora da busca (sem preço ou acima de ${formatarPreco(ORCAMENTO.max)}): ${im.id}`));

  // um elemento por anúncio, criado uma vez (chave = o próprio anúncio): filtrar não recria galerias
  const cards = new Map(lista.map((im) => [im, apresentacao(im)]));
  const locais = opcoesLocal(lista);
  const rotuloDe = (valor) => locais.find((o) => o.valor === valor)?.rotulo ?? "Todos os locais";
  const fmt = (n) => n.toLocaleString("pt-BR");

  // rascunho = o que está sendo editado nos campos; aplicado = o que filtra os resultados
  let rascunho = { ...BUSCA_PADRAO };
  let aplicado = { ...BUSCA_PADRAO };
  const iguais = (a, b) => a.local === b.local && a.max === b.max && a.areaMin === b.areaMin;

  const ui = {
    valor: { local: $('[data-valor="local"]'), valor: $('[data-valor="valor"]'), area: $('[data-valor="area"]') },
    destaque: $("[data-destaque-valor]"),
    textoValor: $("#f-valor"),
    range: $("#f-orcamento"),
    textoArea: $("#f-area"),
    avisoValor: $('[data-aviso="valor"]'),
    avisoArea: $('[data-aviso="area"]'),
    buscar: $("[data-buscar]"),
    pendente: $("[data-pendente]"),
    limpar: $("[data-filtros-limpar]", resultado),
  };
  Object.assign(ui.range, { min: ORCAMENTO.min, max: ORCAMENTO.max, step: ORCAMENTO.passo });

  // opções de localidade e de área geradas pelos anúncios (botões de rádio: setas do teclado navegam)
  const radio = (nome, valor, texto) => {
    const input = el("input", { type: "radio", name: nome, value: valor });
    return { input, label: el("label", { class: "opcao" }, input, el("span", { class: "opcao-marca", "aria-hidden": "true" }), el("span", { class: "opcao-texto" }, texto)) };
  };
  const radiosLocal = [radio("busca-local", "", "Todos os locais"), ...locais.map((o) => radio("busca-local", o.valor, o.rotulo))];
  const radiosArea = [radio("busca-area", "", "Qualquer área"), ...opcoesArea(lista).map((m) => radio("busca-area", String(m), textoArea(m)))];
  $('[data-opcoes="local"]').replaceChildren(...radiosLocal.map((r) => r.label));
  $('[data-opcoes="area"]').replaceChildren(...radiosArea.map((r) => r.label));

  // campos refletem o rascunho; o campo de texto que está sendo digitado não é reescrito
  function atualizar(origem) {
    const textoMax = textoOrcamento(rascunho.max);
    ui.valor.local.textContent = rotuloDe(rascunho.local);
    ui.valor.valor.textContent = textoMax;
    ui.valor.area.textContent = rascunho.areaMin === null ? "Qualquer área" : textoArea(rascunho.areaMin);
    ui.destaque.textContent = textoMax;
    ui.range.value = rascunho.max;
    ui.range.setAttribute("aria-valuetext", textoMax);
    ui.range.style.setProperty("--pct", `${((rascunho.max - ORCAMENTO.min) / (ORCAMENTO.max - ORCAMENTO.min)) * 100}%`);
    radiosLocal.forEach((r) => (r.input.checked = r.input.value === rascunho.local));
    radiosArea.forEach((r) => (r.input.checked = r.input.value === (rascunho.areaMin === null ? "" : String(rascunho.areaMin))));
    if (origem !== "valor-texto") ui.textoValor.value = fmt(rascunho.max);
    if (origem !== "area-texto") ui.textoArea.value = rascunho.areaMin === null ? "" : String(rascunho.areaMin);
    const pendente = !iguais(rascunho, aplicado);
    ui.buscar.toggleAttribute("data-pendente", pendente);
    ui.pendente.textContent = pendente ? "Clique em “Buscar terrenos” para aplicar as alterações." : "";
  }

  // resultados, contagem e etiquetas seguem só o que foi aplicado
  function mostrarResultados(animar = true) {
    const itens = filtrarTerrenos(lista, aplicado);
    catalogo.replaceChildren(...itens.map((im) => cards.get(im)));
    itens.forEach((im) => $$("[data-reveal]", cards.get(im)).forEach((e) => !e.classList.contains("is-in") && revealObserver.observe(e)));
    semResultado.hidden = itens.length > 0;
    contagem.textContent = contagemTerrenos(itens.length);
    const lista_ = [];
    const etiqueta = (texto, remover) => {
      const b = el("button", { type: "button", class: "etiqueta", "aria-label": `Remover filtro: ${texto}` }, el("span", {}, texto), icone("i-close-fino"));
      b.addEventListener("click", () => {
        remover(); // limpa o campo no aplicado e no rascunho; outras edições em andamento continuam
        mostrarResultados();
        atualizar();
        (etiquetas.querySelector(".etiqueta") || ui.buscar).focus();
      });
      return el("li", {}, b);
    };
    if (aplicado.local) lista_.push(etiqueta(`Localidade: ${rotuloDe(aplicado.local)}`, () => (aplicado.local = rascunho.local = "")));
    if (aplicado.max < ORCAMENTO.max) lista_.push(etiqueta(textoOrcamento(aplicado.max), () => (aplicado.max = rascunho.max = ORCAMENTO.max)));
    if (aplicado.areaMin !== null) lista_.push(etiqueta(textoArea(aplicado.areaMin), () => (aplicado.areaMin = rascunho.areaMin = null)));
    etiquetas.replaceChildren(...lista_);
    ui.limpar.hidden = !lista_.length;
    if (animar && !reducedMQ.matches) {
      for (const alvo of [catalogo, semResultado]) alvo.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
    }
  }

  function buscar() {
    fecharPainel(false);
    ui.avisoValor.textContent = ui.avisoArea.textContent = "";
    aplicado = { ...rascunho };
    mostrarResultados();
    atualizar();
  }
  function limparTudo() {
    fecharPainel(false);
    rascunho = { ...BUSCA_PADRAO };
    aplicado = { ...BUSCA_PADRAO };
    ui.avisoValor.textContent = ui.avisoArea.textContent = "";
    mostrarResultados();
    atualizar();
    $("[data-gatilho]", filtros).focus(); // o botão clicado some ao limpar
  }

  // edição dos campos (só o rascunho muda)
  radiosLocal.forEach((r) => r.input.addEventListener("change", () => ((rascunho.local = r.input.value), atualizar())));
  radiosArea.forEach((r) =>
    r.input.addEventListener("change", () => {
      rascunho.areaMin = r.input.value ? Number(r.input.value) : null;
      ui.avisoArea.textContent = "";
      atualizar();
    })
  );
  ui.range.addEventListener("input", () => {
    rascunho.max = Number(ui.range.value);
    ui.avisoValor.textContent = "";
    atualizar();
  });
  ui.textoValor.addEventListener("input", () => {
    const { valor, aviso: msg } = validarValor(ui.textoValor.value);
    ui.avisoValor.textContent = msg;
    if (valor !== null) rascunho.max = valor; // acima do teto vira o teto, com orientação
    atualizar("valor-texto");
  });
  ui.textoValor.addEventListener("change", () => {
    const acimaDoTeto = validarValor(ui.textoValor.value).valor === ORCAMENTO.max && ui.avisoValor.textContent;
    if (!acimaDoTeto) ui.avisoValor.textContent = "";
    ui.textoValor.value = fmt(rascunho.max); // inválido ou vazio volta ao último valor aceito
  });
  ui.textoArea.addEventListener("input", () => {
    const { valor, aviso: msg } = validarArea(ui.textoArea.value);
    ui.avisoArea.textContent = msg;
    if (valor !== undefined) rascunho.areaMin = valor;
    atualizar("area-texto");
  });
  ui.textoArea.addEventListener("change", () => {
    ui.avisoArea.textContent = "";
    ui.textoArea.value = rascunho.areaMin === null ? "" : String(rascunho.areaMin);
  });
  for (const campo of [ui.textoValor, ui.textoArea]) {
    campo.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      campo.dispatchEvent(new Event("change"));
      buscar();
      ui.buscar.focus();
    });
  }
  ui.buscar.addEventListener("click", buscar);
  $$("[data-filtros-limpar]").forEach((b) => b.addEventListener("click", limparTudo));

  // painéis: menu sob o campo no desktop; painel inferior (levado ao body) no celular
  const campos = $$("[data-campo]", filtros);
  const paineis = new Map(campos.map((c) => [c, $("[data-painel]", c)]));
  let aberto = null;
  function abrirPainel(campo) {
    if (aberto === campo) return fecharPainel(true);
    fecharPainel(false);
    aberto = campo;
    const painel = paineis.get(campo);
    const folha = !desktopMQ.matches;
    if (folha) {
      document.body.append(painel); // main tem contenção de layout: um fixed dentro dele não cobriria a tela
      painel.classList.add("is-folha");
      veu.hidden = false;
    }
    painel.hidden = false;
    painel.style.left = painel.style.right = "";
    if (!folha && painel.getBoundingClientRect().right > document.documentElement.clientWidth - 12) Object.assign(painel.style, { left: "auto", right: "0" });
    $("[data-gatilho]", campo).setAttribute("aria-expanded", "true");
    campo.classList.add("is-aberto");
    requestAnimationFrame(() => (painel.classList.add("is-open"), veu.classList.add("is-open")));
    ($("input:checked", painel) || $("input", painel) || $("button", painel)).focus({ preventScroll: true });
  }
  function fecharPainel(devolverFoco) {
    if (!aberto) return;
    const campo = aberto;
    const painel = paineis.get(campo);
    aberto = null;
    painel.classList.remove("is-open", "is-folha");
    painel.hidden = true;
    if (painel.parentElement !== campo) campo.append(painel);
    veu.classList.remove("is-open");
    veu.hidden = true;
    $("[data-gatilho]", campo).setAttribute("aria-expanded", "false");
    campo.classList.remove("is-aberto");
    for (const t of [ui.textoValor, ui.textoArea]) t.dispatchEvent(new Event("change")); // texto pendente volta ao valor aceito
    if (devolverFoco) $("[data-gatilho]", campo).focus({ preventScroll: true });
  }
  campos.forEach((campo) => {
    $("[data-gatilho]", campo).addEventListener("click", () => abrirPainel(campo));
    const painel = paineis.get(campo);
    $$("[data-painel-fechar]", painel).forEach((b) => b.addEventListener("click", () => fecharPainel(true)));
    // foco saiu do campo e do painel (Tab): fecha sem perder o rascunho
    for (const area of [campo, painel]) {
      area.addEventListener("focusout", (ev) => {
        const destino = ev.relatedTarget;
        if (aberto === campo && destino && !campo.contains(destino) && !painel.contains(destino)) fecharPainel(false);
      });
    }
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!aberto || aberto.contains(ev.target) || paineis.get(aberto).contains(ev.target)) return;
    fecharPainel(false); // clique fora (inclusive no véu do celular)
  });
  document.addEventListener("keydown", (ev) => ev.key === "Escape" && aberto && fecharPainel(true));
  desktopMQ.addEventListener("change", () => fecharPainel(false));

  atualizar();
  mostrarResultados(false);
}
carregarImoveis()
  .then(iniciarCatalogo)
  .catch((err) => console.error(err)); // sem os dados, o convite para falar com Marcos continua visível

// ---------- folhas: parallax muito sutil, só no desktop ----------
const leaves = $$("[data-parallax]");
function onScrollParallax() {
  const active = desktopMQ.matches && !reducedMQ.matches;
  for (const el of leaves) {
    if (!active) {
      el.style.translate = "";
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) continue;
    const offset = (r.top + r.height / 2 - innerHeight / 2) * Number(el.dataset.parallax);
    el.style.translate = `0 ${Math.max(-12, Math.min(12, offset)).toFixed(1)}px`;
  }
}

let ticking = false;
function onScroll() {
  // com o menu aberto o body fica fixo (a página "encolhe"): nada a recalcular até ele fechar
  if (ticking || isMenuOpen() || lbAberto) return;
  ticking = true;
  requestAnimationFrame(() => {
    onScrollHeader();
    atualizarAtivo();
    onScrollParallax();
    ticking = false;
  });
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll, { passive: true });
onScroll();
document.fonts?.ready.then(moverIndicador); // larguras finais das opções
desktopMQ.addEventListener("change", moverIndicador);
root.classList.add("is-ready");
