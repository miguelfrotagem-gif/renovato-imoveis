// Verificação no navegador real (Chrome headless via DevTools Protocol, sem dependências).
// Pré-requisito: servidor rodando (npm start).  Uso: npm run verify
// Gera capturas/ com screenshots por viewport e capturas/relatorio.json.
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../js/config.js";
import { publicados, mensagemConhecer, formatarPreco } from "../js/imoveis.js";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE || "http://127.0.0.1:5190/";
const OUT = fileURLToPath(new URL("../capturas/", import.meta.url));
const PORT = 9341;
const vpByName = (n) => VIEWPORTS.find((v) => v.name === n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: "1672x941-ref", w: 1672, h: 941 },
  { name: "1440x900", w: 1440, h: 900 },
  { name: "1366x768", w: 1366, h: 768 },
  { name: "1920x1080", w: 1920, h: 1080 },
  // janelas reais do Chrome maximizado no Windows (abas + barra de endereço + barra de tarefas)
  { name: "chrome-1920x945", w: 1920, h: 945 },
  { name: "chrome-1440x765", w: 1440, h: 765 },
  { name: "chrome-1366x633", w: 1366, h: 633 },
  { name: "2560x1080-ultrawide", w: 2560, h: 1080 },
  { name: "1366x600-baixa", w: 1366, h: 600 },
  { name: "1280x1024", w: 1280, h: 1024 },
  { name: "1024x768", w: 1024, h: 768 },
  { name: "zoom200-1440", w: 720, h: 450, dsf: 2 },
  { name: "768x1024", w: 768, h: 1024, mobile: true },
  { name: "430x932", w: 430, h: 932, mobile: true },
  { name: "390x844", w: 390, h: 844, mobile: true },
  { name: "375x812", w: 375, h: 812, mobile: true },
  { name: "360x800", w: 360, h: 800, mobile: true },
  { name: "320x640", w: 320, h: 640, mobile: true },
];

// ---------- cliente CDP mínimo ----------
class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
  }
  once(method) {
    return new Promise((resolve) => {
      const fn = (p) => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((f) => f !== fn));
        resolve(p);
      };
      this.on(method, fn);
    });
  }
  async eval(fnOrExpr, ...args) {
    const expression = typeof fnOrExpr === "function" ? `(${fnOrExpr})(...${JSON.stringify(args)})` : fnOrExpr;
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async viewport({ w, h, mobile = false, dsf = 1 }) {
    await this.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dsf, mobile });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  }
  async goto(url, settle = 1300) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    await this.eval(() => document.fonts.ready.then(() => true));
    await this.eval(async () => {
      const imgs = [...document.images];
      imgs.forEach((i) => (i.loading = "eager"));
      await Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
      return true;
    });
    await sleep(settle);
  }
  async shot(path) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
  }
  async fullShot(path) {
    const { cssContentSize } = await this.send("Page.getLayoutMetrics");
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 },
    });
    await writeFile(path, Buffer.from(data, "base64"));
  }
  async key(key, code = key, keyCode = 0, text) {
    const base = { key, code, windowsVirtualKeyCode: keyCode };
    await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(150);
  }
  async click(selector, { scroll = true } = {}) {
    const rect = await this.eval(
      (sel, scroll) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        if (scroll) el.scrollIntoView({ block: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      selector,
      scroll
    );
    if (!rect) throw new Error(`não encontrado: ${selector}`);
    await sleep(120);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    }
    await sleep(300);
  }
  async scrollTo(y) {
    await this.eval((y) => {
      document.documentElement.style.scrollBehavior = "auto";
      scrollTo(0, y);
      return true;
    }, y);
    await sleep(500);
  }
}

// ---------- verificações executadas na página ----------
function layoutReport(face) {
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const out = {
    vw,
    vh,
    desktop: matchMedia("(min-width: 900px) and (min-aspect-ratio: 5/4)").matches,
    scrollWidth: document.documentElement.scrollWidth,
    h1: document.querySelectorAll("h1").length,
    // fotos das galerias sem src ainda (carregam sob demanda) não contam como quebradas
    brokenImages: [...document.images].filter((i) => i.getAttribute("src") && (!i.complete || !i.naturalWidth)).map((i) => i.src),
    outside: [],
    overlaps: [],
    sections: [],
    gaps: [],
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && !el.closest(".sprite,.sr-only,.skip-link,.toast");
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${(el.textContent || el.alt || "").trim().slice(0, 40)}"`;
  const content = [...document.querySelectorAll("main h1, main h2, main h3, main p, main a, main button, main li, .site-header a, .site-header button, .site-footer p, .site-footer a, .site-footer li")].filter(visible);

  // conteúdo fora da janela na horizontal
  for (const el of content) {
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) out.outside.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right) });
  }

  // sobreposição entre blocos de texto/controles (ignora ancestrais e descendentes)
  const blocks = [...document.querySelectorAll("main h1, main h2, main p, main .btn, main .link-row, main .faq-q, main .chip, main .step h3, main .sec-logo img, main .faq-a p")].filter(visible);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && h > 2) out.overlaps.push(`${label(a)} × ${label(b)} (${Math.round(w)}×${Math.round(h)})`);
    }
  }

  // seções: altura, conteúdo contido, continuidade
  const secs = [...document.querySelectorAll("main > section")];
  secs.forEach((s, i) => {
    const r = s.getBoundingClientRect();
    const top = r.top + scrollY;
    const kids = [...s.querySelectorAll("h1,h2,h3,p,a,button,li")].filter(visible);
    const maxBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom + scrollY));
    const minTop = Math.min(...kids.map((k) => k.getBoundingClientRect().top + scrollY));
    out.sections.push({
      id: s.id,
      height: Math.round(r.height),
      ratioToViewport: +(r.height / vh).toFixed(3),
      contentInside: maxBottom <= top + r.height + 1 && minTop >= top - 1,
      bg: getComputedStyle(s).backgroundColor,
    });
    if (i > 0) {
      const prev = secs[i - 1].getBoundingClientRect();
      if (Math.abs(prev.bottom - r.top) > 0.5) out.gaps.push(`${secs[i - 1].id}→${s.id}: ${prev.bottom - r.top}`);
    }
  });
  // o rodapé encosta na última seção e encerra a página
  const footer = document.querySelector(".site-footer").getBoundingClientRect();
  const lastSec = secs.at(-1).getBoundingClientRect();
  if (Math.abs(lastSec.bottom - footer.top) > 0.5) out.gaps.push(`${secs.at(-1).id}→rodapé: ${footer.top - lastSec.bottom}`);
  out.trailingSpace = Math.round(document.documentElement.scrollHeight - (footer.bottom + scrollY));

  // rosto do homem inteiro na tela e livre de texto/controles
  const img = document.querySelector(".hero-media img");
  const ir = img.getBoundingClientRect();
  // desktop: cenário inteiro (1672×941); mobile: foto da referência mobile (853×1540)
  const mob = img.currentSrc.includes("home-mobile");
  const nw = mob ? 853 : 1672, nh = mob ? 1540 : 941;
  face = mob ? face.mobile : face.desktop;
  const scale = Math.max(ir.width / nw, ir.height / nh);
  const pos = getComputedStyle(img).objectPosition.split(" ").map(parseFloat);
  const offX = (ir.width - nw * scale) * (pos[0] / 100);
  const offY = (ir.height - nh * scale) * (pos[1] / 100);
  const toPage = (b) => ({
    left: ir.left + offX + b.x0 * scale,
    right: ir.left + offX + b.x1 * scale,
    top: ir.top + scrollY + offY + b.y0 * scale,
    bottom: ir.top + scrollY + offY + b.y1 * scale,
  });
  const boxes = face.map(toPage);
  const fb = {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
  const heroR = document.querySelector(".hero-media").getBoundingClientRect();
  const clipL = heroR.left, clipR = heroR.right; // a moldura recorta só o excedente decorativo
  const hits = [...document.querySelectorAll(".hero-copy *, .brand img, .menu-toggle, .main-nav .nav-list, .header-cta")]
    .filter(visible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const t = r.top + scrollY, b = r.bottom + scrollY;
      return boxes.some((fb) => Math.min(r.right, fb.right) - Math.max(r.left, fb.left) > 1 && Math.min(b, fb.bottom) - Math.max(t, fb.top) > 1);
    })
    .map(label);
  out.face = {
    box: Object.fromEntries(Object.entries(fb).map(([k, v]) => [k, Math.round(v)])),
    widthPx: Math.round(fb.right - fb.left),
    insideViewport: fb.left >= Math.max(0, clipL) - 1 && fb.right <= Math.min(vw, clipR) + 1 && fb.top >= 0,
    overlappedBy: hits,
  };
  return out;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const profile = join(tmpdir(), `renovato-verify-${Date.now()}`);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let page;
  const failures = [];
  const report = { viewports: {}, checks: {} };
  const fail = (msg) => {
    failures.push(msg);
    console.log("  ✗ " + msg);
  };
  const ok = (msg) => console.log("  ✓ " + msg);
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
      } catch {
        await sleep(200);
      }
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    page = new Page(ws);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    // barra de rolagem clássica (como no Chrome do Windows), para validar a largura útil
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `document.addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent="::-webkit-scrollbar{width:15px;height:15px;background:#222}::-webkit-scrollbar-thumb{background:#555}";document.head.append(s)})`,
    });
    // o aviso de privacidade fica de fora das capturas e testes de layout ("Agora não" simulado);
    // ele tem testes próprios mais abaixo
    const { identifier: noNotice } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
      // (a abertura também fica de fora: tem teste próprio)
      source: `try{sessionStorage.setItem("renovato-aviso-privacidade",${JSON.stringify(site.policyVersion)});sessionStorage.setItem("renovato-entrada","1")}catch(e){}`,
    });
    const consoleErrors = [];
    page.on("Runtime.exceptionThrown", (p) => consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
    page.on("Runtime.consoleAPICalled", (p) => p.type === "error" && consoleErrors.push(p.args.map((a) => a.value).join(" ")));

    // rosto (testa ao queixo, orelha a orelha) e topo do cabelo, em pixels de cada foto
    const FACE = {
      desktop: [
        { x0: 1072, y0: 150, x1: 1340, y1: 528 },
        { x0: 1120, y0: 86, x1: 1310, y1: 150 },
      ],
      mobile: [
        { x0: 335, y0: 790, x1: 655, y1: 1172 },
        { x0: 330, y0: 698, x1: 660, y1: 790 },
      ],
    };

    // ---------- layout por viewport ----------
    for (const vp of VIEWPORTS) {
      console.log(`\n[${vp.name}]`);
      await page.viewport(vp);
      await page.goto(BASE);
      const r = await page.eval(layoutReport, FACE);
      report.viewports[vp.name] = r;
      if (r.scrollWidth > r.vw) fail(`${vp.name}: rolagem horizontal (${r.scrollWidth} > ${r.vw})`);
      if (r.h1 !== 1) fail(`${vp.name}: ${r.h1} h1`);
      if (r.brokenImages.length) fail(`${vp.name}: imagens quebradas ${r.brokenImages}`);
      r.outside.forEach((o) => fail(`${vp.name}: fora da tela ${o.el} (${o.left}..${o.right})`));
      r.overlaps.forEach((o) => fail(`${vp.name}: sobreposição ${o}`));
      r.gaps.forEach((g) => fail(`${vp.name}: vão entre seções ${g}`));
      if (r.trailingSpace > 1) fail(`${vp.name}: espaço após a última seção (${r.trailingSpace}px)`);
      r.sections.forEach((s) => !s.contentInside && fail(`${vp.name}: conteúdo vaza da seção #${s.id}`));
      if (!r.face.insideViewport) fail(`${vp.name}: rosto cortado ${JSON.stringify(r.face.box)}`);
      if (r.face.overlappedBy.length) fail(`${vp.name}: rosto coberto por ${r.face.overlappedBy.join(", ")}`);
      ok(`${r.desktop ? "desktop" : "mobile"} · seções ${r.sections.map((s) => `${s.id}=${s.ratioToViewport}`).join(" ")} · rosto ${r.face.widthPx}px`);

      // capturas: desktop por seção (uma tela cada); mobile, página inteira
      if (r.desktop) {
        const tops = await page.eval(() => [...document.querySelectorAll("main > section")].map((s) => [s.id, s.offsetTop, s.offsetHeight]));
        for (const [i, [id, top, height]] of tops.entries()) {
          await page.scrollTo(top);
          await page.eval(() => (document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")), true));
          await sleep(900);
          await page.shot(join(OUT, `${vp.name}-${i + 1}-${id}.png`));
          if (height > r.vh + 2) {
            await page.scrollTo(top + height - r.vh);
            await page.shot(join(OUT, `${vp.name}-${i + 1}-${id}-fim.png`));
          }
        }
        await page.scrollTo(99999);
        await page.shot(join(OUT, `${vp.name}-5-final-rodape.png`));
      } else {
        await page.eval(() => (document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")), true));
        await sleep(900);
        await page.fullShot(join(OUT, `${vp.name}-pagina.png`));
      }
    }

    // ---------- funcionalidade ----------
    for (const vp of [vpByName("1440x900"), vpByName("390x844")]) {
      const mobile = !!vp.mobile;
      console.log(`\n[funcional ${vp.name}]`);
      await page.viewport(vp);
      await page.goto(BASE);

      // menu: âncoras reais + opção ativa
      const navFails = failures.length;
      for (const id of ["imoveis", "sobre", "contato", "inicio"]) {
        if (mobile) {
          await page.click("[data-menu-toggle]", { scroll: false });
          await sleep(200);
        } else {
          // no desktop o cabeçalho some ao descer; o ponteiro no topo o traz de volta
          await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: vp.w / 2, y: 10 });
          await sleep(600);
        }
        await page.click(`${mobile ? ".menu-link" : ".nav-link"}[href="#${id}"]`, { scroll: false });
        await sleep(1400);
        const st = await page.eval((id) => {
          const s = document.getElementById(id);
          return {
            top: Math.round(s.getBoundingClientRect().top),
            current: document.querySelector(".nav-link[aria-current]")?.hash,
            hash: location.hash,
            menuOpen: document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded"),
          };
        }, id);
        const expected = mobile && id !== "inicio" ? 64 : 0;
        if (Math.abs(st.top - expected) > 3) fail(`${vp.name}: menu → #${id} parou em ${st.top}px (esperado ${expected})`);
        if (st.current !== `#${id}`) fail(`${vp.name}: ativo após clicar #${id} = ${st.current}`);
        if (mobile && st.menuOpen !== "false") fail(`${vp.name}: menu não fechou após clicar link`);
      }
      if (failures.length === navFails) ok("menu leva às âncoras e marca a opção ativa");

      // rolagem manual
      const manual = await (async () => {
        const res = [];
        const secs = await page.eval(() => [...document.querySelectorAll("main > section")].map((s) => [s.id, s.offsetTop, s.offsetHeight]));
        for (const [id, top, h] of secs) {
          await page.scrollTo(top + h / 2 - vp.h / 2 + 10);
          await sleep(200);
          res.push([id, await page.eval(() => document.querySelector(".nav-link[aria-current]")?.hash)]);
        }
        return res;
      })();
      // seções fora do menu (Documentação) contam como a opção anterior (Imóveis)
      const esperado = (id) => `#${id === "documentacao" ? "imoveis" : id}`;
      manual.forEach(([id, cur]) => cur !== esperado(id) && fail(`${vp.name}: rolagem manual em #${id} marcou ${cur}`));
      ok(`rolagem manual: ${manual.map(([i, c]) => `${i}→${c}`).join(" ")}`);
      // nenhum trecho da página fica sem opção ativa
      const vazios = await page.eval(async () => {
        document.documentElement.style.scrollBehavior = "auto";
        const out = [];
        for (let y = 0; y < document.documentElement.scrollHeight; y += 160) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 40));
          if (!document.querySelector(".nav-link[aria-current]")) out.push(y);
        }
        return out;
      });
      vazios.length ? fail(`${vp.name}: sem opção ativa em ${vazios.join(", ")}`) : ok("sempre há uma opção ativa ao rolar a página inteira");
      // desktop: o indicador vermelho fica sob a opção ativa e não segue o mouse
      if (!mobile) {
        const secSobre = await page.eval(() => { const s = document.getElementById("sobre"); return s.offsetTop + 40; });
        await page.scrollTo(secSobre - 200);
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: vp.w / 2, y: 10 });
        await sleep(700);
        const medir = () => page.eval(() => {
          const ind = document.querySelector(".nav-indicador").getBoundingClientRect();
          const at = document.querySelector(".nav-link[aria-current]");
          const r = at.getBoundingClientRect();
          return { ativo: at.hash, dx: Math.round(ind.left + ind.width / 2 - (r.left + r.width / 2)), abaixo: ind.top >= r.top };
        });
        const m1 = await medir();
        const contato = await page.eval(() => { const r = document.querySelector('.nav-link[href="#contato"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: contato.x, y: contato.y });
        await sleep(400);
        const hover = await page.eval(() => getComputedStyle(document.querySelector('.nav-link[href="#contato"]'), "::after").transform);
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: contato.x, y: 60 });
        await sleep(400);
        const m2 = await medir();
        m1.ativo === "#sobre" && Math.abs(m1.dx) <= 2 && m1.abaixo && hover !== "none" && m2.ativo === "#sobre" && Math.abs(m2.dx) <= 2
          ? ok("indicador sob a opção ativa; hover tem estilo próprio e o destaque volta à seção ao tirar o mouse")
          : fail(`${vp.name}: indicador ${JSON.stringify({ m1, hover, m2 })}`);
        await page.shot(join(OUT, `menu-desktop-${vp.name}.png`));
      }

      // cabeçalho no desktop: some ao descer e volta ao subir
      if (!mobile) {
        await page.scrollTo(0);
        await page.eval(() => (scrollTo(0, 900), true));
        await sleep(300);
        await page.eval(() => (scrollTo(0, 1600), true));
        await sleep(500);
        const hidden = await page.eval(() => document.querySelector("[data-header]").classList.contains("is-hidden"));
        await page.eval(() => (scrollTo(0, 1400), true));
        await sleep(500);
        const back = await page.eval(() => !document.querySelector("[data-header]").classList.contains("is-hidden"));
        hidden && back ? ok("cabeçalho some ao descer e volta ao subir") : fail(`${vp.name}: cabeçalho hidden=${hidden} back=${back}`);
      }

      // menu mobile por teclado
      if (mobile) {
        await page.scrollTo(0);
        await page.eval(() => (document.querySelector("[data-menu-toggle]").focus(), true));
        await page.key("Enter", "Enter", 13, "\r");
        const opened = await page.eval(() => ({
          exp: document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded"),
          vis: getComputedStyle(document.querySelector("[data-mmenu]")).display !== "none",
          focus: document.activeElement.getAttribute("aria-label"),
        }));
        await page.key("Tab", "Tab", 9);
        const focused = await page.eval(() => document.activeElement.textContent.trim());
        // contenção: Shift+Tab a partir do primeiro elemento vai para o último do painel
        await page.eval(() => (document.querySelector(".mmenu-logo").focus(), true));
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        await sleep(150);
        const wrapped = await page.eval(() => document.activeElement.textContent.trim());
        await page.key("Escape", "Escape", 27);
        const closed = await page.eval(() => ({
          exp: document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded"),
          focus: document.activeElement.matches("[data-menu-toggle]"),
        }));
        opened.exp === "true" && opened.vis && opened.focus === "Fechar menu" && focused.includes("Início") && wrapped === "Falar com Marcos" && closed.exp === "false" && closed.focus
          ? ok("menu mobile: Enter abre com foco em “Fechar menu”, Tab entra nos links, foco contido no painel, Esc fecha e devolve o foco")
          : fail(`${vp.name}: menu teclado ${JSON.stringify({ opened, focused, wrapped, closed })}`);
      }

      // FAQ
      const faqState = () =>
        page.eval(() =>
          [...document.querySelectorAll(".faq-q")].map((b) => {
            const p = document.getElementById(b.getAttribute("aria-controls"));
            return [b.getAttribute("aria-expanded"), Math.round(p.getBoundingClientRect().height), getComputedStyle(p.firstElementChild).visibility];
          })
        );
      const initial = await faqState();
      await page.click("#faq-q3");
      await page.click("#faq-q1");
      await sleep(600);
      const toggled = await faqState();
      await page.eval(() => (document.getElementById("faq-q4").focus(), true));
      await page.key(" ", "Space", 32, " ");
      await sleep(600);
      const byKey = await faqState();
      const sync = (st) => st.every(([e, h, v]) => (e === "true" ? h > 10 && v === "visible" : h <= 1 && v === "hidden"));
      const expect = (st, arr) => st.map((s) => s[0]).join() === arr.join();
      if (expect(initial, ["true", "true", "false", "false", "false", "false"]) && expect(toggled, ["false", "true", "true", "false", "false", "false"]) && expect(byKey, ["false", "true", "true", "true", "false", "false"]) && [initial, toggled, byKey].every(sync))
        ok("FAQ: 6 perguntas, 2 abertas no início, abre/fecha independente, teclado, aria-expanded sincronizado");
      else fail(`${vp.name}: FAQ ${JSON.stringify({ initial, toggled, byKey })}`);

      // contatos reais no DOM (sem clicar: os links levam a serviços externos)
      const links = await page.eval(() =>
        [...document.querySelectorAll("[data-wa], [data-contact], .site-footer a")].map((a) => ({ key: a.dataset.wa ?? null, contact: a.dataset.contact ?? null, href: a.href, target: a.target, rel: a.rel, text: a.textContent.trim(), visible: a.getClientRects().length > 0 }))
      );
      const badWa = links.filter((l) => l.key !== null && (l.href !== (l.key ? `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(site.messages[l.key])}` : `https://wa.me/${site.whatsappNumber}`) || l.target !== "_blank" || !l.rel.includes("noopener")));
      const email = links.find((l) => l.contact === "email");
      const tel = links.find((l) => l.contact === "phone");
      const pol = links.find((l) => l.text === "Política de Privacidade");
      const insta = links.filter((l) => l.contact === "instagram");
      const instaOk = insta.length >= 2 && insta.every((l) => l.href === site.instagram.url && l.text === site.instagram.handle && l.target === "_blank" && l.rel.includes("noopener"));
      !badWa.length && email?.href === `mailto:${site.email}` && email.text === site.email && tel?.href === `tel:${site.phone}` && pol?.visible && instaOk
        ? ok(`${links.filter((l) => l.key !== null).length} links de WhatsApp com a mensagem da seção (${[...new Set(links.filter((l) => l.key).map((l) => l.key))].join(", ")} + contato sem texto); e-mail, telefone e Instagram clicáveis`)
        : fail(`${vp.name}: contatos ${JSON.stringify({ badWa, email, tel, pol, insta })}`);
      report.checks[`links-${vp.name}`] = links;

      // rodapé → política
      await page.click(".site-footer a[href='politica-de-privacidade/']");
      await sleep(900);
      const polNav = await page.eval(() => ({ path: location.pathname, h1: document.querySelector("h1")?.textContent.replace(/\s+/g, " ").trim() }));
      polNav.path === "/politica-de-privacidade/" && polNav.h1 === "Política de Privacidade — Renovato Imóveis"
        ? ok("link do rodapé abre a Política de Privacidade")
        : fail(`${vp.name}: rodapé → política ${JSON.stringify(polNav)}`);
    }

    // menu mobile: camada clara com dois blocos brancos, em retrato e na horizontal
    console.log("\n[menu mobile]");
    for (const vp of [vpByName("320x640"), vpByName("360x800"), vpByName("390x844"), vpByName("430x932"), { name: "celular-horizontal-844x390", w: 844, h: 390, mobile: true }]) {
      await page.viewport(vp);
      await page.goto(BASE);
      const tops = await page.eval(() => Object.fromEntries([...document.querySelectorAll("main > section")].map((s) => [s.id, s.offsetTop + s.offsetHeight / 2])));
      const y0 = Math.round(tops.imoveis - vp.h / 2);
      await page.scrollTo(y0);
      const issues = [];
      for (let round = 0; round < 4; round++) {
        await page.click("[data-menu-toggle]", { scroll: false });
        await sleep(450);
        const m = await page.eval(() => {
          const p = document.querySelector("[data-mmenu]");
          const r = p.getBoundingClientRect();
          const s = p.querySelector(".mmenu-scroll");
          const vw = document.documentElement.clientWidth;
          const out = [...p.querySelectorAll("*")].filter((e) => e.getClientRects().length).filter((e) => { const b = e.getBoundingClientRect(); return b.left < -1 || b.right > vw + 1; }).map((e) => e.className.baseVal ?? e.className);
          const [bar, nav] = [...p.querySelectorAll(".mmenu-card")].map((c) => c.getBoundingClientRect());
          const rows = [...p.querySelectorAll(".menu-link")].map((a) => {
            const n = a.querySelector("span"), ar = a.getBoundingClientRect(), ic = a.querySelector(".menu-icon").getBoundingClientRect();
            return { name: n.textContent, oneLine: n.getClientRects().length === 1, fits: n.scrollWidth <= Math.ceil(n.getBoundingClientRect().width) + 1 && ar.right <= nav.right, h: Math.round(ar.height), textX: Math.round(n.getBoundingClientRect().left), iconW: Math.round(ic.width) };
          });
          const cta = p.querySelector(".mmenu-cta").getBoundingClientRect();
          const logo = p.querySelector(".mmenu-logo img");
          const lr = logo.getBoundingClientRect();
          const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          return {
            cover: Math.round(r.left) === 0 && Math.round(r.top) === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight,
            onTop: p.contains(center),
            overflowX: s.scrollWidth > s.clientWidth,
            out,
            cards: { barW: Math.round(bar.width), navW: Math.round(nav.width), sameX: Math.abs(bar.left - nav.left) < 0.5 && Math.abs(bar.right - nav.right) < 0.5, side: Math.round(bar.left), top: Math.round(bar.top), gap: Math.round(nav.top - bar.bottom), barH: Math.round(bar.height), navH: Math.round(nav.height) },
            logo: { ratio: +(lr.width / lr.height).toFixed(3), natural: +(logo.naturalWidth / logo.naturalHeight).toFixed(3), h: Math.round(lr.height) },
            rows,
            cta: { w: Math.round(cta.width), h: Math.round(cta.height), navInner: Math.round(nav.width - 22), oneLine: p.querySelector(".mmenu-cta").getClientRects().length === 1 && cta.height < 64 },
            locked: document.body.style.position === "fixed",
            inert: document.querySelector("main").inert && document.querySelector("[data-header]").inert,
            current: p.querySelector(".menu-link[aria-current]")?.hash,
            bg: getComputedStyle(p).backgroundColor,
          };
        });
        if (round === 0) await page.shot(join(OUT, `menu-${vp.name}.png`));
        // a roda do mouse/toque sobre o painel não move a página ao fundo
        await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: vp.w / 2, y: vp.h / 2, deltaX: 0, deltaY: 600 });
        await sleep(300);
        // o fim do painel é alcançável (telas baixas rolam por dentro)
        const end = await page.eval(() => {
          const s = document.querySelector(".mmenu-scroll");
          s.scrollTop = s.scrollHeight;
          const b = document.querySelector(".mmenu-cta").getBoundingClientRect();
          return { visible: b.bottom <= innerHeight + 1 && b.top >= 0, ctaOverList: b.top < document.querySelector(".mmenu-list").getBoundingClientRect().bottom - 1 };
        });
        if (round === 0 && vp.h < 500) await page.shot(join(OUT, `menu-${vp.name}-fim.png`));
        await page.eval(() => ((document.querySelector(".mmenu-scroll").scrollTop = 0), true));
        // toque dentro de um bloco (no espaço em branco do topo, longe dos cantos arredondados) não fecha
        const inside = await page.eval(() => { const r = document.querySelector(".mmenu-nav").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 5 }; });
        for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: inside.x, y: inside.y, button: "left", clickCount: 1 });
        await sleep(250);
        const stillOpen = await page.eval(() => document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded") === "true");
        if (!stillOpen) issues.push("tocar dentro do bloco fechou o menu");
        // fecha de três formas: X, Esc e toque na camada fora dos blocos (margem lateral)
        if (round % 3 === 0) await page.click("[data-menu-close]");
        else if (round % 3 === 1) await page.key("Escape", "Escape", 27);
        else for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: 3, y: Math.round(vp.h * 0.6), button: "left", clickCount: 1 });
        await sleep(350);
        const after = await page.eval(() => ({
          y: Math.round(scrollY),
          hidden: document.querySelector("[data-mmenu]").hidden,
          body: document.body.style.position,
          inert: document.querySelector("main").inert,
          blocked: !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("[data-mmenu]"),
          focus: document.activeElement.matches("[data-menu-toggle]"),
        }));
        if (!m.cover || !m.onTop) issues.push(`painel não cobre a tela ${JSON.stringify({ cover: m.cover, onTop: m.onTop })}`);
        if (m.overflowX || m.out.length) issues.push(`conteúdo fora da largura ${JSON.stringify(m.out)}`);
        m.rows.filter((r) => !r.fits || !r.oneLine).forEach((r) => issues.push(`“${r.name}” cortado ou em mais de uma linha`));
        if (m.rows.some((r) => r.h < 44)) issues.push("linha do menu com menos de 44px");
        if (new Set(m.rows.map((r) => r.textX)).size !== 1 || new Set(m.rows.map((r) => r.iconW)).size !== 1) issues.push(`textos/ícones desalinhados ${JSON.stringify(m.rows)}`);
        const c = m.cards;
        const expectedW = Math.min(vp.w - 16, 480);
        if (!c.sameX || c.barW !== c.navW || Math.abs(c.barW - expectedW) > 1) issues.push(`blocos com larguras diferentes ou fora do esperado ${JSON.stringify(c)}`);
        if (c.top !== 8 || c.gap < 8 || c.gap > 12 || c.barH < 68 || c.barH > 76) issues.push(`posição dos blocos ${JSON.stringify(c)}`);
        if (vp.h > 600 && c.navH > Math.min(vp.h * 0.62, 400)) issues.push(`bloco da navegação esticado (${c.navH}px)`);
        if (Math.abs(m.logo.ratio - m.logo.natural) > 0.02 || m.logo.h < 44 || m.logo.h > 52) issues.push(`logo distorcida ou fora do tamanho ${JSON.stringify(m.logo)}`);
        if (!m.cta.oneLine || m.cta.h < 54 || m.cta.h > 60 || m.cta.w < m.cta.navInner - 1) issues.push(`botão de contato ${JSON.stringify(m.cta)}`);
        if (m.bg !== "rgba(246, 243, 239, 0.95)") issues.push(`camada externa ${m.bg}`);
        if (!m.locked || !m.inert) issues.push("fundo não bloqueado");
        if (m.current !== "#imoveis") issues.push(`item ativo ${m.current} (esperado #imoveis)`);
        if (!end.visible || end.ctaOverList) issues.push(`fim do painel ${JSON.stringify(end)}`);
        if (Math.abs(after.y - y0) > 1) issues.push(`rolagem não restaurada (${after.y} ≠ ${y0})`);
        if (!after.hidden || after.body || after.inert || after.blocked) issues.push(`camada restante após fechar ${JSON.stringify(after)}`);
        if (!after.focus) issues.push("foco não voltou ao botão do menu");
      }
      [...new Set(issues)].forEach((i) => fail(`menu ${vp.name}: ${i}`));
      if (!issues.length) ok(`${vp.name}: 2 blocos de ${Math.min(vp.w - 16, 480)}px alinhados e compactos, textos em 1 linha, logo sem distorção, CTA largo, fundo travado, fecha por X/Esc/toque fora, rolagem restaurada (4 aberturas)`);
    }
    // ao abrir, o destaque reflete a seção atual
    {
      await page.viewport(vpByName("390x844"));
      await page.goto(BASE);
      const mids = await page.eval(() => [...document.querySelectorAll("main > section")].map((s) => [s.id, Math.max(0, Math.round(s.offsetTop + s.offsetHeight / 2 - innerHeight / 2))]));
      const got = [];
      for (const [id, y] of mids) {
        await page.scrollTo(y);
        await page.click("[data-menu-toggle]", { scroll: false });
        await sleep(400);
        got.push([id, await page.eval(() => document.querySelector(".menu-link[aria-current]")?.hash.slice(1))]);
        await page.key("Escape", "Escape", 27);
        await sleep(300);
      }
      got.every(([id, cur]) => (id === "documentacao" ? "imoveis" : id) === cur) ? ok(`destaque ao abrir: ${got.map(([i, c]) => `${i}→${c}`).join(" ")}`) : fail(`destaque ao abrir ${JSON.stringify(got)}`);
    }

    // seção de terrenos com os dados reais: apresentações, busca (localidade, valor, área), galerias, ampliação e WhatsApp
    console.log("\n[terrenos — dados reais]");
    {
      const reais = publicados(JSON.parse(await readFile(new URL("../data/imoveis.json", import.meta.url), "utf8"))).filter((i) => i.tipo === "Terreno");
      const esperadoWa = reais.map((im) => `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(mensagemConhecer(im))}`);
      const BRAG = "Jardim Bonança — Bragança Paulista";
      const JOAN = "Jardim São João — Joanópolis";
      const estado = () =>
        page.eval(() => ({
          titulos: [...document.querySelectorAll(".apr-titulo")].map((t) => t.textContent),
          contagem: document.querySelector("[data-catalogo-contagem]").textContent,
          etiquetas: [...document.querySelectorAll(".etiqueta")].map((e) => e.textContent.trim()),
          vazio: !document.querySelector("[data-catalogo-vazio]").hidden,
          pendente: document.querySelector("[data-pendente]").textContent,
          gatilhos: [...document.querySelectorAll("[data-valor]")].map((v) => v.textContent),
          range: Number(document.getElementById("f-orcamento").value),
          avisos: ["valor", "area"].map((k) => document.querySelector(`[data-aviso="${k}"]`).textContent), // por campo: no celular o painel vai para o body
          limpar: !document.querySelector("[data-resultado] [data-filtros-limpar]").hidden,
          aberto: [...document.querySelectorAll("[data-gatilho]")].filter((g) => g.getAttribute("aria-expanded") === "true").length,
          contadores: [...document.querySelectorAll(".apr-contador")].map((c) => c.textContent),
        }));
      const abrir = async (campo) => (await page.click(`[data-campo="${campo}"] [data-gatilho]`), await sleep(250));
      const concluir = async (campo) => (await page.click(`#painel-${campo} .painel-concluir`), await sleep(200));
      const escolher = (campo, texto) => page.eval((campo, texto) => ([...document.querySelectorAll(`#painel-${campo} .opcao`)].find((o) => o.textContent.includes(texto)).click(), true), campo, texto);
      const digitar = (id, v) => page.eval((id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); return true; }, id, v);
      const buscar = async () => (await page.click("[data-buscar]"), await sleep(300));
      const limparTudo = async () => (await page.click("[data-resultado] [data-filtros-limpar]"), await sleep(250));
      for (const vp of [vpByName("1440x900"), vpByName("1366x768"), vpByName("1024x768"), vpByName("430x932"), vpByName("390x844"), vpByName("360x800")]) {
        const issues = [];
        const check = (cond, msg) => !cond && issues.push(msg);
        await page.viewport(vp);
        await page.goto(BASE);
        const base = await page.eval(() => {
          const vw = document.documentElement.clientWidth;
          const r = (e) => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
          return {
            aprs: [...document.querySelectorAll(".apr")].map((a) => ({
              id: a.id,
              minis: a.querySelectorAll(".apr-mini").length,
              fotos: [...a.querySelectorAll(".apr-foto")].map((i) => i.getAttribute("src") || ""),
              wa: a.querySelector(".apr-wa").href,
              waTxt: a.querySelector(".apr-wa").textContent.trim(),
              palco: r(a.querySelector(".apr-palco")),
              largura: Math.round(a.getBoundingClientRect().width),
              preco: a.querySelector(".apr-preco").textContent,
            })),
            campos: [...document.querySelectorAll(".busca-campo")].map(r),
            botao: r(document.querySelector("[data-buscar]")),
            barra: r(document.querySelector(".busca-barra")),
            rotulosUmaLinha: [...document.querySelectorAll(".busca-rotulo")].every((e) => e.getClientRects().length === 1),
            aviso: !document.querySelector("[data-catalogo-aviso]").hidden,
            sw: document.documentElement.scrollWidth,
            vw,
            out: [...document.querySelectorAll(".busca *, .busca-resultado *, .apr *")].filter((e) => e.getClientRects().length && !e.closest(".apr-miniaturas, [data-painel]")).filter((e) => { const b = e.getBoundingClientRect(); return b.left < -1 || b.right > vw + 1; }).map((e) => e.className.baseVal ?? e.className),
          };
        });
        const st0 = await estado();
        check(st0.titulos.join("|") === reais.map((i) => i.titulo).join("|"), `terrenos exibidos ${JSON.stringify(st0.titulos)}`);
        check(st0.contagem === "2 terrenos encontrados" && !st0.etiquetas.length && !st0.limpar && !st0.pendente, `estado inicial ${JSON.stringify(st0)}`);
        check(st0.gatilhos.join("|") === "Todos os locais|Até R$ 270.000|Qualquer área" && st0.range === 270000, `valores iniciais ${JSON.stringify(st0.gatilhos)}`);
        check(!base.aviso && base.rotulosUmaLinha, "convite vazio visível ou rótulo quebrado");
        base.aprs.forEach((a, i) => {
          check(a.minis === reais[i].fotos.length, `${a.id}: ${a.minis} miniaturas`);
          check(a.wa === esperadoWa[i] && a.waTxt === "Quero conhecer este terreno", `${a.id}: WhatsApp ${a.wa}`);
          check(!a.fotos.some((s) => s && !s.includes(`/${reais[i].id}/`)), `${a.id}: foto de outro anúncio`);
          check(a.palco.w >= a.largura * (vp.mobile ? 0.98 : 0.58) && a.palco.h >= 300, `${a.id}: foto pequena ${JSON.stringify(a.palco)} de ${a.largura}`); // celular: largura útil; desktop: ~63% do anúncio
          check(a.preco === formatarPreco(reais[i].preco), `${a.id}: preço ${a.preco}`);
        });
        check(base.sw <= base.vw && !base.out.length, `ultrapassa a largura ${JSON.stringify(base.out)}`);
        // disposição da barra
        const [cl, cv, ca] = base.campos;
        if (!vp.mobile && vp.w >= 1200) check(cl.t === cv.t && cv.t === ca.t && Math.abs(base.botao.t + base.botao.h / 2 - (cl.t + cl.h / 2)) < 4 && cl.w > base.botao.w, `desktop: barra numa linha ${JSON.stringify(base)}`);
        if (!vp.mobile && vp.w < 1200) check(cl.t === cv.t && ca.t > cl.t && Math.abs(ca.t - base.botao.t) < 12, `desktop estreito: duas linhas ${JSON.stringify(base.campos)}`);
        if (vp.mobile && vp.w >= 400) check(cl.w > cv.w * 1.6 && cv.t === ca.t && base.botao.w > base.barra.w - 24, `celular largo: local inteiro, valor e área lado a lado ${JSON.stringify(base)}`);
        if (vp.mobile && vp.w < 400) check(cl.t < cv.t && cv.t < ca.t && cl.w === cv.w && base.botao.w > base.barra.w - 24, `celular estreito: uma coluna ${JSON.stringify(base)}`);
        // painéis: abrir, dentro da tela, foco, Esc, clique fora
        for (const campo of ["local", "valor", "area"]) {
          await abrir(campo);
          const p = await page.eval((campo) => {
            const pn = document.getElementById(`painel-${campo}`);
            const b = pn.getBoundingClientRect();
            return { visivel: !pn.hidden, folha: pn.classList.contains("is-folha"), pai: pn.parentElement.tagName, l: b.left, r: b.right, top: b.top, bottom: b.bottom, vw: document.documentElement.clientWidth, vh: innerHeight, foco: pn.contains(document.activeElement), sobre: document.elementFromPoint(b.left + b.width / 2, Math.min(b.top + 30, innerHeight - 2))?.closest(".busca-painel") === pn };
          }, campo);
          check(p.visivel && p.foco && p.sobre && p.l >= -1 && p.r <= p.vw + 1, `painel ${campo} ${JSON.stringify(p)}`);
          if (vp.mobile) check(p.folha && p.pai === "BODY" && Math.abs(p.bottom - p.vh) < 2 && p.top >= 0, `painel inferior ${campo} ${JSON.stringify(p)}`);
          if (campo === "local") {
            await page.key("Escape", "Escape", 27);
            const e = await page.eval(() => ({ fechado: document.getElementById("painel-local").hidden, foco: document.activeElement.matches('[data-campo="local"] [data-gatilho]'), exp: document.querySelector('[data-campo="local"] [data-gatilho]').getAttribute("aria-expanded") }));
            check(e.fechado && e.foco && e.exp === "false", `Esc no painel ${JSON.stringify(e)}`);
          } else {
            // clique fora (no celular, no véu acima do painel)
            for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: 6, y: vp.mobile ? 40 : vp.h - 20, button: "left", clickCount: 1 });
            await sleep(200);
            check((await estado()).aberto === 0, `clique fora não fechou o painel ${campo}`);
          }
        }
        if (vp.name === "1440x900" || vp.name === "390x844") {
          await abrir("valor");
          await page.shot(join(OUT, `busca-painel-valor-${vp.name}.png`));
          await page.key("Escape", "Escape", 27);
        }
        // rascunho x aplicado: escolher não filtra; "Buscar terrenos" aplica
        await abrir("local");
        await escolher("local", JOAN);
        await concluir("local");
        let s = await estado();
        check(s.gatilhos[0] === JOAN && s.contagem === "2 terrenos encontrados" && s.pendente.includes("Buscar terrenos"), `rascunho não deveria filtrar ${JSON.stringify(s)}`);
        await buscar();
        s = await estado();
        check(s.titulos.join() === "Terreno em Joanópolis/SP" && s.contagem === "1 terreno encontrado" && s.etiquetas.join() === `Localidade: ${JOAN}` && !s.pendente && s.limpar, `localidade ${JSON.stringify(s)}`);
        await page.click(".etiqueta");
        await sleep(250);
        s = await estado();
        check(s.titulos.length === 2 && !s.etiquetas.length && s.gatilhos[0] === "Todos os locais" && s.contagem === "2 terrenos encontrados", `remover etiqueta ${JSON.stringify(s)}`);
        // valor máximo sozinho: campo e controle sincronizados; teto, preço igual, acima do teto
        await abrir("valor");
        await digitar("f-valor", "269000");
        s = await estado();
        check(s.range === 269000 && s.gatilhos[1] === "Até R$ 269.000", `campo → controle ${JSON.stringify(s)}`);
        await concluir("valor");
        await buscar();
        s = await estado();
        check(s.titulos.join() === "Terreno em Joanópolis/SP" && s.etiquetas.join() === "Até R$ 269.000", `valor máximo ${JSON.stringify(s)}`);
        await abrir("valor");
        await page.eval(() => { const r = document.getElementById("f-orcamento"); r.value = 170000; r.dispatchEvent(new Event("input", { bubbles: true })); return true; });
        const txt = await page.eval(() => document.getElementById("f-valor").value);
        check(txt === "170.000", `controle → campo ${txt}`);
        await concluir("valor");
        await buscar();
        s = await estado();
        check(s.titulos.join() === "Terreno em Joanópolis/SP", "preço igual ao valor máximo (R$ 170.000) não incluído");
        await abrir("valor");
        await digitar("f-valor", "300000");
        s = await estado();
        check(s.range === 270000 && s.gatilhos[1] === "Até R$ 270.000" && /máximo da busca é R\$ 270\.000/.test(s.avisos[0]), `acima do teto ${JSON.stringify(s)}`);
        await digitar("f-valor", "-5");
        s = await estado();
        check(s.range === 270000 && /apenas números/.test(s.avisos[0]), `valor inválido ${JSON.stringify(s)}`);
        await concluir("valor");
        check((await page.eval(() => document.getElementById("f-valor").value)) === "270.000", "campo de valor não voltou ao último valor aceito");
        await buscar();
        s = await estado();
        check(s.titulos.length === 2 && !s.etiquetas.length, `teto de R$ 270.000 inclui o terreno de R$ 270.000 ${JSON.stringify(s)}`);
        // área mínima sozinha: atalho real e digitada
        await abrir("area");
        await escolher("area", "314 m²");
        await concluir("area");
        await buscar();
        s = await estado();
        check(s.titulos.join() === "Terreno em Joanópolis/SP" && s.etiquetas.join() === "A partir de 314 m²", `área mínima ${JSON.stringify(s)}`);
        await abrir("area");
        await digitar("f-area", "264");
        await concluir("area");
        await buscar();
        s = await estado();
        check(s.titulos.length === 2 && s.etiquetas.join() === "A partir de 264 m²", `área igual à mínima ${JSON.stringify(s)}`);
        await abrir("area");
        await digitar("f-area", "0");
        s = await estado();
        check(/maior que zero/.test(s.avisos[1]), `área zero ${JSON.stringify(s.avisos)}`);
        await concluir("area");
        await limparTudo();
        // combinação dos três e resultado vazio
        await abrir("local");
        await escolher("local", BRAG);
        await concluir("local");
        await abrir("valor");
        await digitar("f-valor", "270000");
        await concluir("valor");
        await abrir("area");
        await digitar("f-area", "250");
        await concluir("area");
        await buscar();
        s = await estado();
        check(s.titulos.join() === "Terreno em Bragança Paulista" && s.etiquetas.join("|") === `Localidade: ${BRAG}|A partir de 250 m²`, `combinação ${JSON.stringify(s)}`);
        await abrir("area");
        await digitar("f-area", "300");
        await concluir("area");
        await buscar();
        s = await estado();
        check(!s.titulos.length && s.vazio && s.contagem === "Nenhum terreno encontrado", `vazio ${JSON.stringify(s)}`);
        const vazioTxt = await page.eval(() => document.querySelector("[data-catalogo-vazio] p").textContent + " | " + document.querySelector("[data-catalogo-vazio] a").href);
        check(vazioTxt.startsWith("Nenhum terreno encontrado com esses critérios. | https://wa.me/5511925993517?text="), `texto do vazio ${vazioTxt}`);
        if (vp.name === "390x844" || vp.name === "1440x900") {
          await page.eval(() => (document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")), document.querySelector(".busca").scrollIntoView({ block: "start", behavior: "instant" }), scrollBy(0, -90), true));
          await sleep(400);
          await page.shot(join(OUT, `busca-vazio-${vp.name}.png`));
        }
        await page.click("[data-catalogo-vazio] [data-filtros-limpar]");
        await sleep(300);
        s = await estado();
        check(s.titulos.length === 2 && !s.etiquetas.length && !s.vazio && s.gatilhos.join("|") === "Todos os locais|Até R$ 270.000|Qualquer área" && s.range === 270000 && s.contagem === "2 terrenos encontrados", `limpar tudo ${JSON.stringify(s)}`);
        // teclado: Enter abre, seta escolhe, Esc fecha e devolve o foco
        await page.eval(() => (document.querySelector('[data-campo="local"] [data-gatilho]').focus(), true));
        await page.key("Enter", "Enter", 13, "\r");
        await sleep(250);
        const k1 = await page.eval(() => document.activeElement.type === "radio" && document.activeElement.checked);
        await page.key("ArrowDown", "ArrowDown", 40);
        const k2 = (await estado()).gatilhos[0];
        await page.key("Escape", "Escape", 27);
        const k3 = await page.eval(() => document.activeElement.matches('[data-campo="local"] [data-gatilho]') && document.getElementById("painel-local").hidden);
        check(k1 && k2 === BRAG && k3, `teclado ${JSON.stringify({ k1, k2, k3 })}`);
        await page.eval(() => (document.querySelector("[data-catalogo-vazio] [data-filtros-limpar]").click(), true)); // descarta o rascunho do teste de teclado
        await sleep(200);
        // toque (celular): tocar no campo abre o painel inferior; tocar no véu fecha
        if (vp.mobile) {
          const pt = await page.eval(() => { const g = document.querySelector('[data-campo="area"] [data-gatilho]'); g.scrollIntoView({ block: "center", behavior: "instant" }); const b = g.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
          await sleep(150);
          await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
          await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await sleep(350);
          const t1 = await page.eval(() => document.getElementById("painel-area").classList.contains("is-folha") && !document.getElementById("painel-area").hidden);
          await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 20, y: 30 }] });
          await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await sleep(300);
          const t2 = await page.eval(() => document.getElementById("painel-area").hidden && document.querySelector("[data-busca-veu]").hidden);
          check(t1 && t2, `toque ${JSON.stringify({ t1, t2 })}`);
        }
        // galerias independentes; o estado sobrevive à busca
        await page.eval(() => { const a = document.querySelectorAll(".apr"); a[1].querySelector(".apr-prox").click(); a[1].querySelector(".apr-prox").click(); a[0].querySelectorAll(".apr-mini")[3].click(); return true; });
        await sleep(350);
        s = await estado();
        const ativa = await page.eval(() => [...document.querySelectorAll(".apr")].map((a) => a.querySelector(".apr-foto.is-ativa").getAttribute("src")));
        check(s.contadores.join("|") === "4 de 4|3 de 4" && ativa[0].endsWith(`${reais[0].id}/04.webp`) && ativa[1].endsWith(`${reais[1].id}/03.webp`), `galerias ${JSON.stringify({ c: s.contadores, ativa })}`);
        await abrir("local");
        await escolher("local", JOAN);
        await concluir("local");
        await buscar();
        await page.click(".etiqueta");
        await sleep(250);
        check((await estado()).contadores.join("|") === "4 de 4|3 de 4", "a busca mudou as galerias");
        // ampliação: abre na foto selecionada, setas/teclado, Esc fecha, foco e posição restaurados
        await page.eval(() => (document.querySelectorAll(".apr")[1].scrollIntoView({ block: "center", behavior: "instant" }), true));
        await sleep(300);
        const y0 = await page.eval(() => Math.round(scrollY));
        await page.click(".apr:nth-child(2) .apr-ampliar", { scroll: false });
        await sleep(450);
        const lb1 = await page.eval(() => {
          const l = document.querySelector("[data-lightbox]");
          const f = l.querySelector("[data-lb-foto]");
          const x = l.querySelector("[data-lb-fechar]").getBoundingClientRect();
          return { aberto: !l.hidden, cont: l.querySelector("[data-lb-contador]").textContent, titulo: l.querySelector("[data-lb-titulo]").textContent, src: f.getAttribute("src"), fit: getComputedStyle(f).objectFit, body: document.body.style.position, xVisivel: x.top >= 0 && x.right <= innerWidth && x.width >= 44, foco: document.activeElement.matches("[data-lb-fechar]") };
        });
        await page.key("ArrowRight", "ArrowRight", 39);
        const lb2 = await page.eval(() => document.querySelector("[data-lb-contador]").textContent);
        await page.key("Escape", "Escape", 27);
        await sleep(350);
        const lb3 = await page.eval(() => ({ fechado: document.querySelector("[data-lightbox]").hidden, y: Math.round(scrollY), body: document.body.style.position, foco: document.activeElement === document.querySelectorAll(".apr")[1].querySelector(".apr-ampliar"), cont: document.querySelectorAll(".apr-contador")[1].textContent }));
        check(lb1.aberto && lb1.cont === "3 de 4" && lb1.titulo === reais[1].titulo && lb1.src.endsWith(`${reais[1].id}/03.webp`) && lb1.fit === "contain" && lb1.body === "fixed" && lb1.xVisivel && lb1.foco, `ampliação ${JSON.stringify(lb1)}`);
        check(lb2 === "4 de 4", `seta do teclado na ampliação: ${lb2}`);
        check(lb3.fechado && Math.abs(lb3.y - y0) <= 1 && !lb3.body && lb3.foco && lb3.cont === "4 de 4", `fechar ampliação ${JSON.stringify({ y0, ...lb3 })}`);
        // celular: deslizar troca a foto (toque)
        if (vp.mobile) {
          const p = await page.eval(() => { const b = document.querySelectorAll(".apr")[0].querySelector(".apr-palco"); b.scrollIntoView({ block: "center", behavior: "instant" }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          await sleep(200);
          const pts = (x) => [{ x, y: p.y }];
          await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(p.x + 90) });
          await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(p.x) });
          await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(p.x - 90) });
          await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await sleep(400);
          const sw = await page.eval(() => ({ c: document.querySelectorAll(".apr-contador")[0].textContent, lb: !document.querySelector("[data-lightbox]").hidden }));
          check(sw.c === "1 de 4" && !sw.lb, `deslizar ${JSON.stringify(sw)}`); // estava em 4 de 4: avança e volta ao início
        }
        issues.forEach((i) => fail(`terrenos ${vp.name}: ${i}`));
        if (!issues.length) ok(`${vp.name}: barra organizada; painéis (Esc, clique fora${vp.mobile ? ", painel inferior, toque" : ""}, teclado); localidade, valor, área e combinação; etiquetas; limpar; vazio; preço e área iguais aos limites; teto de R$ 270.000; galerias, ampliação e WhatsApp preservados`);
        await page.eval(() => (document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")), document.querySelector(".imoveis-head").scrollIntoView({ block: "start", behavior: "instant" }), scrollBy(0, -80), true));
        await sleep(700);
        await page.shot(join(OUT, `terrenos-${vp.name}.png`));
      }
      // página do anúncio
      await page.viewport(vpByName("390x844"));
      await page.goto(BASE + `imovel/?id=${reais[1].id}`, 1200);
      const det = await page.eval(() => ({ h1: document.querySelector("h1")?.textContent, preco: document.querySelector(".det-preco")?.textContent, cont: document.querySelector(".galeria-contador")?.textContent, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      det.h1 === reais[1].titulo && det.preco === "R$ 170.000" && det.cont === `1 / ${reais[1].fotos.length}` && det.sw <= det.vw
        ? ok(`página do anúncio: ${det.h1}, ${det.preco}, galeria ${det.cont}`)
        : fail(`página do anúncio ${JSON.stringify(det)}`);
    }

    // regras com dados de TESTE (data/imoveis.json interceptado só aqui): sem preço, acima do teto e casas ficam
    // de fora; as localidades e áreas do painel vêm dos terrenos válidos
    console.log("\n[terrenos — regras com dados de teste]");
    {
      const foto = [{ arquivo: "assets/img/duvidas-mobile-640.webp", alt: "Foto de teste" }];
      const FIXTURE = { imoveis: [
        { id: "t-sem-preco", publicado: true, titulo: "[TESTE] Terreno sem preço", tipo: "Terreno", cidade: "Atibaia", bairro: "Bairro A", preco: null, areas: [{ rotulo: "Área do terreno", m2: 500 }], fotos: foto },
        { id: "t-caro", publicado: true, titulo: "[TESTE] Terreno acima do teto", tipo: "Terreno", cidade: "Atibaia", bairro: "Bairro B", preco: 300000, fotos: foto },
        { id: "casa", publicado: true, titulo: "[TESTE] Casa", tipo: "Casa", cidade: "Piracaia", preco: 100000, fotos: foto },
        { id: "t-ok", publicado: true, titulo: "[TESTE] Terreno no orçamento", tipo: "Terreno", cidade: "Atibaia", bairro: "Bairro C", preco: 150000, fotos: foto },
      ] };
      await page.send("Fetch.enable", { patterns: [{ urlPattern: "*data/imoveis.json*" }] });
      page.on("Fetch.requestPaused", (p) =>
        page.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" }], body: Buffer.from(JSON.stringify(FIXTURE)).toString("base64") })
      );
      await page.viewport(vpByName("390x844"));
      await page.goto(BASE);
      const r = await page.eval(() => ({
        titulos: [...document.querySelectorAll(".apr-titulo")].map((t) => t.textContent),
        contagem: document.querySelector("[data-catalogo-contagem]").textContent,
        setas: document.querySelectorAll(".apr-seta, .apr-mini, .apr-contador").length,
        locais: [...document.querySelectorAll("#painel-local .opcao")].map((o) => o.textContent),
        areas: [...document.querySelectorAll("#painel-area .opcao")].map((o) => o.textContent),
      }));
      // o painel de áreas só traz áreas informadas (o terreno sem área não vira "0 m²")
      r.titulos.join() === "[TESTE] Terreno no orçamento" && r.contagem === "1 terreno encontrado" && r.setas === 0 && !r.locais.some((l) => l.includes("Piracaia")) && r.areas.join("|") === "Qualquer área|A partir de 500 m²"
        ? ok("sem preço, acima do teto e casa ficam de fora; localidades só de terrenos; área ausente não vira zero; 1 terreno no singular")
        : fail(`regras ${JSON.stringify(r)}`);
      await page.send("Fetch.disable");
      page.listeners.set("Fetch.requestPaused", []);
    }

    // WhatsApp sem número (config.js interceptado só neste teste): aviso acessível, sem navegar
    console.log("\n[WhatsApp sem número — simulado]");
    await page.viewport(vpByName("1440x900"));
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*js/config.js*" }] });
    const original = await readFile(new URL("../js/config.js", import.meta.url), "utf8");
    const patched = original.replace(/whatsappNumber:[^\n]*/, `whatsappNumber: "",`);
    const handler = (p) =>
      page.send("Fetch.fulfillRequest", {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/javascript; charset=utf-8" }],
        body: Buffer.from(patched).toString("base64"),
      });
    page.on("Fetch.requestPaused", handler);
    await page.goto(BASE, 400);
    const before = await page.eval(() => location.href);
    await page.click(".hero-cta2");
    await sleep(300);
    const fb = await page.eval(() => {
      const t = document.querySelector("[data-toast]");
      return { text: t.textContent, visible: getComputedStyle(t).opacity > 0.5, role: t.getAttribute("role"), href: location.href };
    });
    fb.text === site.fallbackMessage && fb.visible && fb.role === "status" && fb.href === before
      ? ok("sem número: aviso em role=status, nenhum link inválido aberto")
      : fail(`fallback ${JSON.stringify(fb)}`);
    report.checks.fallback = fb;
    await page.send("Fetch.disable");
    page.listeners.set("Fetch.requestPaused", []);

    // aviso de privacidade: primeira visita, aceite, "Agora não", nova versão, sem armazenamento
    console.log("\n[aviso de privacidade]");
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: noNotice });
    const KEY = "renovato-aviso-privacidade";
    // limpa tudo menos a marcação da abertura (ela tem teste próprio e atrasaria o aviso)
    const clearStorage = () => page.eval(() => (localStorage.clear(), sessionStorage.clear(), sessionStorage.setItem("renovato-entrada", "1"), true));
    const noticeState = () =>
      page.eval((key) => {
        const n = document.querySelector("[data-privacy]");
        const r = n.getBoundingClientRect();
        const hit = (sel) => [...document.querySelectorAll(sel)].some((e) => { const b = e.getBoundingClientRect(); return e.getClientRects().length && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; });
        let local = null, session = null;
        try { local = localStorage.getItem(key); session = sessionStorage.getItem(key); } catch {}
        return {
          shown: !n.hidden && getComputedStyle(n).opacity > 0.9,
          rect: { l: Math.round(r.left), r: Math.round(innerWidth - r.right), b: Math.round(innerHeight - r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
          vh: innerHeight,
          collides: hit(".menu-toggle, .header-cta, .main-nav .nav-list"),
          local,
          session,
        };
      }, KEY);
    const freshLoad = async () => {
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url: BASE });
      await loaded;
      const early = await noticeState();
      await sleep(1400);
      return { early, now: await noticeState() };
    };
    for (const vp of [vpByName("1440x900"), vpByName("390x844"), vpByName("360x800")]) {
      const mobile = !!vp.mobile;
      const issues = [];
      await page.viewport(vp);
      await page.goto(BASE, 0);
      await clearStorage();
      // 1. primeira visita: aparece depois de um pequeno atraso
      const first = await freshLoad();
      if (first.early.shown || !first.now.shown) issues.push(`primeira visita ${JSON.stringify({ antes: first.early.shown, depois: first.now.shown })}`);
      const g = first.now.rect;
      if (mobile ? Math.abs(g.l - 16) > 1 || Math.abs(g.r - 16) > 1 || Math.abs(g.b - 16) > 1 : Math.abs(g.l - 24) > 1 || Math.abs(g.b - 24) > 1 || g.w > 420) issues.push(`posição ${JSON.stringify(g)}`);
      if (g.h > first.now.vh * 0.42) issues.push(`aviso alto demais (${g.h}px de ${first.now.vh})`);
      if (first.now.collides) issues.push("aviso colide com menu/contato do cabeçalho");
      if (mobile) await page.shot(join(OUT, `aviso-${vp.name}.png`));
      if (vp.name === "1440x900") {
        await page.shot(join(OUT, `aviso-${vp.name}.png`));
        // teclado: 1º Tab = "Pular para o conteúdo", 2º Tab = fechar aviso; o foco não fica preso
        await page.eval(() => (document.activeElement.blur(), true));
        await page.key("Tab", "Tab", 9);
        await page.key("Tab", "Tab", 9);
        const k1 = await page.eval(() => document.activeElement.getAttribute("aria-label"));
        for (let i = 0; i < 6; i++) await page.key("Tab", "Tab", 9);
        const k2 = await page.eval(() => !document.activeElement.closest("[data-privacy]"));
        if (k1 !== "Fechar aviso" || !k2) issues.push(`teclado ${JSON.stringify({ k1, saiuDoAviso: k2 })}`);
      }
      // 2. "Agora não": sem aceite; não volta nesta sessão
      await page.click(".pn-later", { scroll: false });
      await sleep(450);
      const later = await noticeState();
      if (later.shown || later.local !== null || later.session !== site.policyVersion) issues.push(`agora não ${JSON.stringify(later)}`);
      const sameSession = await freshLoad();
      if (sameSession.now.shown) issues.push("reapareceu na mesma sessão");
      // 3. aceite: guarda versão e data; nova sessão não mostra de novo
      await page.eval((key) => (sessionStorage.removeItem(key), true), KEY);
      const again = await freshLoad();
      if (!again.now.shown) issues.push("não voltou em nova sessão sem aceite");
      await page.click(".pn-accept", { scroll: false });
      await sleep(450);
      const acc = await noticeState();
      let rec = null;
      try { rec = JSON.parse(acc.local); } catch {}
      if (acc.shown || rec?.versao !== site.policyVersion || !(Date.parse(rec?.data) > 0) || Object.keys(rec || {}).join() !== "versao,data") issues.push(`aceite ${JSON.stringify(acc)}`);
      await page.eval((key) => (sessionStorage.removeItem(key), true), KEY);
      const returning = await freshLoad();
      if (returning.now.shown) issues.push("reapareceu após aceite");
      // 4. nova versão da política: volta a aparecer; o X fecha sem aceite
      await page.eval((key) => (localStorage.setItem(key, JSON.stringify({ versao: "2000-01-01", data: "2000-01-01T00:00:00.000Z" })), true), KEY);
      const newVersion = await freshLoad();
      if (!newVersion.now.shown) issues.push("não reapareceu com nova versão da política");
      // 5. com o menu mobile aberto, o aviso fica por baixo e inerte
      if (mobile) {
        await page.click("[data-menu-toggle]", { scroll: false });
        await sleep(450);
        const under = await page.eval(() => {
          const n = document.querySelector("[data-privacy]").getBoundingClientRect();
          return { covered: !!document.elementFromPoint(n.left + n.width / 2, n.top + n.height / 2)?.closest("[data-mmenu]"), inert: document.querySelector("[data-privacy]").inert };
        });
        if (!under.covered || !under.inert) issues.push(`menu × aviso ${JSON.stringify(under)}`);
        await page.key("Escape", "Escape", 27);
        await sleep(350);
      }
      await page.click(".pn-close", { scroll: false });
      await sleep(450);
      const closedX = await noticeState();
      if (closedX.shown || JSON.parse(closedX.local).versao !== "2000-01-01") issues.push(`fechar (X) ${JSON.stringify(closedX)}`);
      issues.forEach((i) => fail(`aviso ${vp.name}: ${i}`));
      if (!issues.length) ok(`${vp.name}: aparece após ~800ms, posição certa, “Agora não”/X sem aceite, aceite com versão+data, nova versão reaparece${vp.name === "1440x900" ? ", teclado sem prender o foco" : ", fica sob o menu aberto"}`);
    }
    // armazenamento indisponível: o aviso aparece, fecha e o site continua funcionando
    {
      await page.viewport(vpByName("390x844"));
      const errorsBefore = consoleErrors.length;
      const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `for (const k of ["localStorage","sessionStorage"]) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException("bloqueado", "SecurityError"); } });`,
      });
      const st = await freshLoad();
      await page.click(".pn-accept", { scroll: false });
      await sleep(450);
      const gone = await page.eval(() => document.querySelector("[data-privacy]").hidden);
      await page.click("#faq-q3");
      await sleep(600);
      const faqOk = await page.eval(() => document.getElementById("faq-q3").getAttribute("aria-expanded") === "true");
      await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      st.now.shown && gone && faqOk && consoleErrors.length === errorsBefore
        ? ok("sem localStorage/sessionStorage: aviso aparece e fecha, nenhum erro, site funcionando")
        : fail(`armazenamento indisponível ${JSON.stringify({ shown: st.now.shown, gone, faqOk, erros: consoleErrors.slice(errorsBefore) })}`);
    }
    // link do aviso abre a política
    await page.goto(BASE, 0);
    await clearStorage();
    await freshLoad();
    await page.click(".pn-link", { scroll: false });
    await sleep(900);
    const pnPath = await page.eval(() => location.pathname);
    pnPath === "/politica-de-privacidade/" ? ok("“Ler Política de Privacidade” abre a página") : fail(`aviso → política ${pnPath}`);

    // abertura com a logo e o nome: primeira visita da sessão, termina sozinha, pula com toque,
    // não repete na mesma aba, não aparece com movimento reduzido e não cobre o aviso de privacidade
    console.log("\n[abertura]");
    const navegar = async (settle) => {
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url: BASE });
      await loaded;
      await sleep(settle);
    };
    for (const vp of [vpByName("1440x900"), vpByName("390x844"), vpByName("320x640")]) {
      const issues = [];
      await page.viewport(vp);
      await page.goto(BASE, 0);
      await page.eval(() => (localStorage.clear(), sessionStorage.clear(), true));
      await navegar(1750);
      const during = await page.eval(() => {
        const o = document.querySelector("[data-intro]");
        const r = o.getBoundingClientRect();
        const nome = o.querySelector(".intro-nome");
        const nr = nome.getBoundingClientRect();
        return {
          cls: document.documentElement.classList.contains("com-abertura"),
          cover: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight,
          nome: nome.textContent,
          nomeVisivel: +getComputedStyle(nome).opacity > 0.5,
          nomeCabe: nr.left >= 0 && nr.right <= innerWidth,
          logo: o.querySelector(".intro-logo").naturalWidth > 0,
          heroPausado: getComputedStyle(document.querySelector(".hero-title")).animationPlayState === "paused",
          aviso: !document.querySelector("[data-privacy]").hidden,
        };
      });
      await page.shot(join(OUT, `abertura-${vp.name}.png`));
      await sleep(1900);
      const depois = await page.eval(() => ({
        cls: document.documentElement.classList.contains("com-abertura"),
        oculta: getComputedStyle(document.querySelector("[data-intro]")).display === "none",
        marca: sessionStorage.getItem("renovato-entrada"),
        sw: document.documentElement.scrollWidth,
        vw: document.documentElement.clientWidth,
      }));
      await sleep(1300);
      const avisoDepois = await page.eval(() => !document.querySelector("[data-privacy]").hidden && document.querySelector(".hero-title").getBoundingClientRect().width > 0 && getComputedStyle(document.querySelector(".hero-title")).opacity === "1");
      await navegar(300);
      const repetiu = await page.eval(() => document.documentElement.classList.contains("com-abertura"));
      await page.eval(() => (sessionStorage.removeItem("renovato-entrada"), true));
      await navegar(450);
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: Math.round(vp.w / 2), y: Math.round(vp.h / 2), button: "left", clickCount: 1 });
      await sleep(500);
      const pulou = await page.eval(() => !document.documentElement.classList.contains("com-abertura"));
      if (!during.cls || !during.cover || during.nome !== site.ownerName || !during.nomeVisivel || !during.nomeCabe || !during.logo || !during.heroPausado) issues.push(`durante ${JSON.stringify(during)}`);
      if (during.aviso) issues.push("aviso de privacidade apareceu por cima da abertura");
      if (depois.cls || !depois.oculta || depois.marca !== "1" || depois.sw > depois.vw) issues.push(`depois ${JSON.stringify(depois)}`);
      if (!avisoDepois) issues.push("site/aviso não apareceram depois da abertura");
      if (repetiu) issues.push("abertura repetiu na mesma sessão");
      if (!pulou) issues.push("toque não pulou a abertura");
      issues.forEach((i) => fail(`abertura ${vp.name}: ${i}`));
      if (!issues.length) ok(`${vp.name}: logo e “${site.ownerName}” cobrindo a tela, entrada do site em espera, termina em ~3 s, aviso só depois, não repete na sessão, toque pula`);
    }
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.eval(() => (sessionStorage.clear(), true));
    await navegar(300);
    const introReduzido = await page.eval(() => document.documentElement.classList.contains("com-abertura"));
    await page.send("Emulation.setEmulatedMedia", { features: [] });
    !introReduzido ? ok("movimento reduzido: sem abertura") : fail("abertura exibida com movimento reduzido");

    // rede, cookies e armazenamento: nada de terceiros; só o registro do aviso, e só depois do clique
    console.log("\n[rede, cookies e armazenamento]");
    await page.goto(BASE, 0);
    await clearStorage();
    await page.send("Network.enable");
    const requests = [];
    page.on("Network.requestWillBeSent", (p) => requests.push(p.request.url));
    await page.send("Network.clearBrowserCookies");
    await page.goto(BASE, 1400);
    await page.click("#faq-q3");
    await page.scrollTo(99999);
    await sleep(600);
    // na sessão só pode existir a marcação da abertura (aviso de "já exibida")
    const beforeAccept = await page.eval(() => ({ local: localStorage.length, session: Object.keys(sessionStorage).filter((k) => k !== "renovato-entrada").length, cookie: document.cookie }));
    await page.click(".pn-accept", { scroll: false });
    await sleep(500);
    await page.goto(BASE + "politica-de-privacidade", 600);
    const { cookies } = await page.send("Network.getAllCookies");
    const storage = await page.eval(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage).filter((k) => k !== "renovato-entrada").length, cookie: document.cookie }));
    const foreign = [...new Set(requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:")))];
    !foreign.length && !cookies.length && !beforeAccept.local && !beforeAccept.session && !beforeAccept.cookie && storage.local.join() === KEY && !storage.session && !storage.cookie
      ? ok(`${requests.length} requisições, todas do próprio site; 0 cookies; nada gravado antes do clique; depois do aceite, só “${KEY}” (nenhum rastreador ativado)`)
      : fail(`privacidade ${JSON.stringify({ foreign, cookies: cookies.map((c) => c.name), beforeAccept, storage })}`);
    page.listeners.set("Network.requestWillBeSent", []);
    await page.send("Network.disable");

    // política: URL direta com e sem barra, atualização, layout
    console.log("\n[política de privacidade]");
    for (const path of ["politica-de-privacidade", "politica-de-privacidade/", "sitemap.xml", "robots.txt", "assets/img/compartilhar.jpg"]) {
      const res = await fetch(BASE + path);
      res.status === 200 ? ok(`GET /${path} → 200`) : fail(`/${path} → ${res.status}`);
    }
    // endereço inexistente: página 404 da marca, com status 404 e estilos carregados mesmo em caminho profundo
    {
      const res = await fetch(BASE + "imoveis/nao-existe");
      const body = await res.text();
      await page.viewport(vpByName("390x844"));
      await page.goto(BASE + "imoveis/nao-existe", 600);
      const p404 = await page.eval(() => ({ h1: document.querySelector("h1")?.textContent, css: getComputedStyle(document.body).backgroundColor, logo: document.querySelector(".det-logo img").naturalWidth > 0, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      res.status === 404 && body.includes("Página não encontrada") && p404.h1 === "Página não encontrada" && p404.css === "rgb(1, 23, 28)" && p404.logo && p404.sw <= p404.vw
        ? ok("endereço inexistente → 404 com a página da marca (estilos e logo carregados)")
        : fail(`404 ${JSON.stringify({ status: res.status, ...p404 })}`);
      await page.shot(join(OUT, "404-390x844.png"));
    }
    for (const vp of [vpByName("1440x900"), vpByName("1366x768"), vpByName("390x844"), vpByName("360x800")]) {
      await page.viewport(vp);
      await page.goto(BASE + "politica-de-privacidade", 900);
      await page.send("Page.reload");
      await sleep(1200);
      const p = await page.eval(() => {
        const vw = document.documentElement.clientWidth;
        const out = [...document.querySelectorAll("main *, header *, footer *")].filter((e) => e.getClientRects().length && !e.closest(".skip-link")).filter((e) => {
          const r = e.getBoundingClientRect();
          return r.left < -1 || r.right > vw + 1;
        });
        const cssOk = getComputedStyle(document.body).backgroundColor === "rgb(1, 23, 28)";
        const imgs = [...document.images].every((i) => i.complete && i.naturalWidth);
        const back = [...document.querySelectorAll("a")].filter((a) => a.textContent.trim() === "Voltar ao site").map((a) => a.href);
        return { vw, sw: document.documentElement.scrollWidth, out: out.map((e) => e.tagName + "." + e.className), cssOk, imgs, back, logo: document.querySelector(".policy-logo").href, h1: document.querySelectorAll("h1").length };
      });
      const okP = p.sw <= p.vw && !p.out.length && p.cssOk && p.imgs && p.h1 === 1 && p.logo === BASE && p.back.length && p.back.every((h) => h === BASE);
      okP ? ok(`${vp.name}: CSS e logo carregados após atualizar, sem rolagem lateral, voltar e logo levam ao início`) : fail(`política ${vp.name}: ${JSON.stringify(p)}`);
      await page.shot(join(OUT, `politica-${vp.name}.png`));
      if (vp.mobile) await page.fullShot(join(OUT, `politica-${vp.name}-pagina.png`));
    }
    await page.click(".policy-back");
    await sleep(900);
    const backPath = await page.eval(() => location.pathname);
    backPath === "/" ? ok("“Voltar ao site” leva ao início") : fail(`voltar → ${backPath}`);

    // movimento reduzido: conteúdo visível sem rolar e sem animação
    console.log("\n[movimento reduzido]");
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.goto(BASE, 200);
    const rm1 = await page.eval(() => ({
      hidden: [...document.querySelectorAll("[data-reveal], .enter, .brand, .main-nav, .header-cta")].filter((e) => getComputedStyle(e).opacity < 0.99).length,
      anim: getComputedStyle(document.querySelector(".hero-title")).animationDuration,
      smooth: getComputedStyle(document.documentElement).scrollBehavior,
    }));
    rm1.hidden === 0 && rm1.smooth === "auto" ? ok(`nada oculto, animação ${rm1.anim}, scroll ${rm1.smooth}`) : fail(`movimento reduzido ${JSON.stringify(rm1)}`);
    await page.goto(BASE + "politica-de-privacidade", 100);
    const rm2 = await page.eval(() => getComputedStyle(document.querySelector(".policy-intro")).opacity);
    rm2 === "1" ? ok("política: título visível de imediato") : fail(`política com movimento reduzido: opacidade ${rm2}`);
    await page.send("Emulation.setEmulatedMedia", { features: [] });

    // sem JavaScript: todo o conteúdo visível
    console.log("\n[sem JavaScript]");
    await page.send("Emulation.setScriptExecutionDisabled", { value: true });
    await page.goto(BASE, 3000);
    const nojs = await page.eval("({hidden:[...document.querySelectorAll('[data-reveal], .enter, .faq-a > div')].filter(e=>getComputedStyle(e).opacity<0.99||getComputedStyle(e).visibility==='hidden').length, nav:getComputedStyle(document.querySelector('.nav-list')).display, panel:getComputedStyle(document.querySelector('[data-mmenu]')).display, notice:getComputedStyle(document.querySelector('[data-privacy]')).display, aviso:getComputedStyle(document.querySelector('[data-catalogo-aviso]')).display})").catch(() => null);
    await page.send("Emulation.setScriptExecutionDisabled", { value: false });
    // Runtime.evaluate continua funcionando com scripts da página desativados
    nojs && nojs.hidden === 0 && nojs.nav !== "none" && nojs.panel === "none" && nojs.notice === "none" && nojs.aviso !== "none"
      ? ok(`sem JS: nada oculto, menu ${nojs.nav}, painel e aviso fora do caminho, catálogo convida a falar com Marcos`)
      : fail(`sem JS: ${JSON.stringify(nojs)}`);

    // texto ampliado (fonte padrão 24px = 150%)
    console.log("\n[texto ampliado 150%]");
    await page.send("Page.setFontSizes", { fontSizes: { standard: 24, fixed: 20 } }).catch(() => null);
    for (const vp of [vpByName("1366x768"), vpByName("390x844")]) {
      await page.viewport(vp);
      await page.goto(BASE);
      const r = await page.eval(layoutReport, FACE);
      const issues = [...r.outside.map((o) => o.el), ...r.overlaps, ...r.sections.filter((s) => !s.contentInside).map((s) => s.id)];
      if (r.scrollWidth > r.vw) issues.push("rolagem horizontal");
      issues.length ? issues.forEach((i) => fail(`texto 150% ${vp.name}: ${i}`)) : ok(`${vp.name}: sem cortes, sobreposições ou rolagem lateral (seções ${r.sections.map((s) => s.ratioToViewport).join(" ")})`);
      if (r.desktop) {
        const tops = await page.eval(() => [...document.querySelectorAll("main > section")].map((s) => s.offsetTop));
        await page.scrollTo(tops[0]);
        await page.shot(join(OUT, `texto150-${vp.name}-1.png`));
        await page.scrollTo(tops[3]);
        await page.eval(() => (document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")), true));
        await sleep(800);
        await page.shot(join(OUT, `texto150-${vp.name}-4.png`));
      } else {
        await page.eval(() => (document.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-in")), true));
        await sleep(800);
        await page.fullShot(join(OUT, `texto150-${vp.name}-pagina.png`));
      }
    }
    await page.send("Page.setFontSizes", { fontSizes: { standard: 16, fixed: 13 } }).catch(() => null);

    if (consoleErrors.length) consoleErrors.forEach((e) => fail(`erro no console: ${e}`));
    report.consoleErrors = consoleErrors;
  } finally {
    report.failures = failures;
    await writeFile(join(OUT, "relatorio.json"), JSON.stringify(report, null, 2));
    try {
      page?.ws.close();
    } catch {}
    chrome.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failures.length ? `\n${failures.length} problema(s). Ver capturas/relatorio.json` : "\nTudo certo.");
  process.exitCode = failures.length ? 1 : 0;
}

main();
