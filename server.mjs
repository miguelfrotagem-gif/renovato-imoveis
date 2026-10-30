// Servidor estático local, sem dependências.  Uso: node server.mjs [porta]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5190);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    let file = normalize(join(root, path));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end();
      return;
    }
    // /politica-de-privacidade (sem barra) entrega a página da pasta, como na hospedagem
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js", ".mjs"].includes(ext) ? "no-store" : "public, max-age=3600",
    });
    res.end(await readFile(file));
  } catch {
    // como na Vercel: endereço inexistente recebe a página 404.html, com status 404
    const page = await readFile(join(root, "404.html")).catch(() => "Não encontrado");
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(page);
  }
}).listen(port, "127.0.0.1", () => console.log(`Renovato Imóveis em http://localhost:${port}`));
