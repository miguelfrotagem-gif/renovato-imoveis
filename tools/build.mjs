// Copia os dados de js/config.js para as páginas HTML (links e textos marcados).
// Uso: npm run build
//   <a data-wa="chave">            → href wa.me com a mensagem da chave ("" = sem mensagem), target/rel
//   <a data-contact="email">       → href mailto: e texto do e-mail
//   <a data-contact="whatsapp">    → texto do número exibido (o href vem de data-wa)
//   <a data-contact="phone">       → href tel: (texto mantido)
//   <a data-contact="instagram">   → href e texto (@perfil) do Instagram, em nova aba
//   <tag data-site="campo">        → texto de site[campo] (ownerFullName, creci, region, role…)
//   <meta|link data-url="/caminho"> → content/href absoluto com site.siteUrl (compartilhamento, canonical)
// Também gera sitemap.xml com as páginas fixas e os anúncios publicados em data/imoveis.json.
import { readFile, writeFile } from "node:fs/promises";
import { site } from "../js/config.js";
import { waLink } from "../js/whatsapp.js";
import { publicados } from "../js/imoveis.js";

export const PAGES = ["index.html", "imovel/index.html", "politica-de-privacidade/index.html", "404.html"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function setAttrs(tag, attrs) {
  let t = tag;
  for (const [name, value] of Object.entries(attrs)) {
    const re = new RegExp(`\\s${name}="[^"]*"`);
    if (value === null) t = t.replace(re, "");
    else if (re.test(t)) t = t.replace(re, ` ${name}="${esc(value)}"`);
    else t = t.replace(/^<(\w+)\b/, `<$1 ${name}="${esc(value)}"`);
  }
  return t;
}

export function syncContacts(html) {
  let out = html.replace(/<a\b[^>]*\sdata-wa="([^"]*)"[^>]*>/g, (tag, key) => {
    const href = waLink(site.whatsappNumber, site.messages[key]);
    return setAttrs(tag, href ? { href, target: "_blank", rel: "noopener noreferrer" } : { href: "#contato", target: null, rel: null });
  });
  out = out.replace(/(<a\b[^>]*\sdata-contact="(email|whatsapp|phone|instagram)"[^>]*>)([^<]*)(<\/a>)/g, (m, tag, kind, text, end) => {
    if (kind === "email") return setAttrs(tag, { href: `mailto:${site.email}` }) + esc(site.email) + end;
    if (kind === "phone") return setAttrs(tag, { href: `tel:${site.phone}` }) + text + end;
    if (kind === "instagram") return setAttrs(tag, { href: site.instagram.url, target: "_blank", rel: "noopener noreferrer" }) + esc(site.instagram.handle) + end;
    return tag + esc(site.phoneDisplay) + end;
  });
  out = out.replace(/(<(\w+)\b[^>]*\sdata-site="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tagName, key, text, close) => {
    if (typeof site[key] !== "string") throw new Error(`data-site="${key}" não existe em js/config.js`);
    return open + esc(site[key]) + close;
  });
  out = out.replace(/<(meta|link)\b[^>]*\sdata-url="([^"]*)"[^>]*>/g, (tag, kind, path) =>
    setAttrs(tag, { [kind === "meta" ? "content" : "href"]: siteBase() + path })
  );
  return out;
}

const siteBase = () => site.siteUrl.replace(/\/$/, "");

/** sitemap.xml: páginas fixas + detalhes de cada anúncio publicado (mesma regra do site). */
export function sitemap(dados) {
  const urls = ["/", "/politica-de-privacidade/", ...publicados(dados).map((im) => `/imovel/?id=${encodeURIComponent(im.id)}`)];
  const linhas = urls.map((u) => `  <url><loc>${esc(siteBase() + u)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${linhas.join("\n")}\n</urlset>\n`;
}
export const robots = () => `User-agent: *\nAllow: /\n\nSitemap: ${siteBase()}/sitemap.xml\n`;

if (process.argv[1]?.endsWith("build.mjs")) {
  for (const page of PAGES) {
    const url = new URL(`../${page}`, import.meta.url);
    const before = await readFile(url, "utf8");
    const after = syncContacts(before);
    if (after !== before) await writeFile(url, after);
    console.log(`${page}: ${after === before ? "já sincronizado" : "contatos atualizados"}`);
  }
  const dados = JSON.parse(await readFile(new URL("../data/imoveis.json", import.meta.url), "utf8"));
  for (const [file, content] of [["sitemap.xml", sitemap(dados)], ["robots.txt", robots()]]) {
    await writeFile(new URL(`../${file}`, import.meta.url), content);
    console.log(`${file}: gerado`);
  }
}
