# Gera os assets web a partir das referências aprovadas (referencias/*.png ficam intactos).
# Uso: python tools/make_images.py
# Não há originais de foto/logo no projeto: as áreas fotográficas são recortadas das referências
# e textos/contornos de interface que caem dentro do recorte são removidos por inpainting de traço.
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "referencias"
OUT = ROOT / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)


def load(name):
    return cv2.imread(str(REF / name), cv2.IMREAD_COLOR)


def stroke_mask(img, rects, thresh=22, dilate=2, bright=256):
    """Máscara só dos traços (texto/contorno) que se destacam do entorno dentro de cada retângulo.
    `bright` também marca pixels claros (miolo de letras grossas sobre céu escuro)."""
    mask = np.zeros(img.shape[:2], np.uint8)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)
    blur = cv2.medianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), 21).astype(np.int16)
    b, g, r = [c.astype(np.int16) for c in cv2.split(img)]
    red = (r - np.maximum(g, b)) > 60
    for x0, y0, x1, y1 in rects:
        diff = (np.abs(gray - blur) > thresh) | (gray > bright)
        mask[y0:y1, x0:x1] |= (diff[y0:y1, x0:x1] | red[y0:y1, x0:x1]).astype(np.uint8) * 255
    if dilate:
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=dilate)
    return mask


def inpaint(img, rects, **kw):
    return cv2.inpaint(img, stroke_mask(img, rects, **kw), 6, cv2.INPAINT_TELEA)


def save_webp(img_bgr, stem, widths, quality=84):
    rgb = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    for w in widths:
        im = rgb if w >= rgb.width else rgb.resize((w, round(rgb.height * w / rgb.width)), Image.LANCZOS)
        path = OUT / f"{stem}-{im.width}.webp"
        im.save(path, "WEBP", quality=quality, method=6)
        print(f"{path.name}  {im.width}x{im.height}  {path.stat().st_size // 1024} KB")


# 1 · Home desktop: o cenário inteiro, sem a interface da referência (logo, menu, textos, botão).
# A copy HTML ocupa o mesmo lugar; a região dos textos ainda recebe um desfoque suave
# para que nenhum vestígio de letra apareça sob o degradê de leitura.
full = load("01-home.png")
ui_text = [
    (112, 24, 312, 164),   # logo
    (538, 22, 1136, 90),   # menu
    (1394, 22, 1594, 90),  # Fale conosco
    (122, 218, 532, 250),  # chamada superior
    (122, 254, 174, 270),  # traço vermelho
    (118, 278, 838, 532),  # título
    (118, 535, 656, 612),  # descrição
    (120, 744, 602, 756),  # divisória
    (122, 762, 502, 812),  # documentação
    (1496, 868, 1620, 898),  # nota
]
mask = stroke_mask(full, ui_text, thresh=18, dilate=3, bright=105)
cv2.rectangle(mask, (92, 618), (632, 744), 255, -1)  # botão vermelho e seu brilho
full = cv2.inpaint(full, mask, 9, cv2.INPAINT_TELEA)
soft = cv2.GaussianBlur(cv2.dilate(mask, np.ones((25, 25), np.uint8)), (0, 0), 14).astype(np.float32)[..., None] / 255
full = (full * (1 - soft) + cv2.GaussianBlur(full, (0, 0), 7) * soft).astype(np.uint8)
save_webp(full, "home-cenario", [1672, 1280], quality=82)
og_scene = cv2.resize(full[30:908, 0:1672], (1200, 630), interpolation=cv2.INTER_AREA)  # usada no fim, com a logo

# A paisagem do lote não entra mais no site (fotos de imóveis vêm só dos anúncios reais, em
# assets/imoveis/); dessa tela ficam apenas as folhas decorativas.
ter = load("02-terrenos-valores.png")

# 3 · Documentação: montagem fotográfica sobreposta (sem a logo do canto e sem a nota)
doc = load("03-documentacao.png")
doc = inpaint(doc, [(92, 92, 282, 150), (222, 800, 330, 824)], dilate=3)
save_webp(doc[96:941, 0:884], "documentacao-montagem", [884, 560])

# 4 · Dúvidas: pôr do sol com o marco vermelho (descrição removida do céu)
faq = load("04-duvidas-contato.png")
faq = inpaint(faq, [(112, 372, 556, 446), (64, 706, 192, 734)], thresh=18, dilate=3)
# versão desktop com o céu: logo, chamada e título removidos (o título HTML ocupa o mesmo lugar)
faq_full = inpaint(faq, [(118, 14, 272, 126), (110, 144, 360, 202), (110, 200, 770, 372)], thresh=18, dilate=4, bright=120)
save_webp(faq_full[0:745, 0:842], "duvidas-ceu", [842])

# Folhas desfocadas das bordas (decorativas)
save_webp(ter[142:300, 0:400], "folhas-terrenos", [400])
doc_leaves = inpaint(load("03-documentacao.png"), [(1246, 56, 1468, 86), (1472, 64, 1652, 80)])
save_webp(doc_leaves[0:150, 1292:1672], "folhas-documentacao", [380])

# ---------- Mobile (referências 853×1844, uma tela de 390×844 cada) ----------
def clean(img, regions, solid=(), blur_px=6):
    """Remove a interface: cada região é (x0, y0, x1, y1, bright); `solid` são retângulos preenchidos inteiros.
    A área tratada recebe um desfoque suave, porque a copy HTML ocupa o mesmo lugar."""
    mask = np.zeros(img.shape[:2], np.uint8)
    for x0, y0, x1, y1, bright in regions:
        mask |= stroke_mask(img, [(x0, y0, x1, y1)], thresh=18, dilate=3, bright=bright)
    for x0, y0, x1, y1 in solid:
        cv2.rectangle(mask, (x0, y0), (x1, y1), 255, -1)
    out = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)
    if blur_px:
        soft = cv2.GaussianBlur(cv2.dilate(mask, np.ones((21, 21), np.uint8)), (0, 0), 12).astype(np.float32)[..., None] / 255
        out = (out * (1 - soft) + cv2.GaussianBlur(out, (0, 0), blur_px) * soft).astype(np.uint8)
    return out


# 1m · Home: Marcos integrado ao céu e à paisagem; o céu fica atrás do título HTML
m1 = clean(load("mobile-01-home.png"), [
    (50, 28, 275, 190, 256),    # logo
    (55, 228, 650, 268, 110),   # chamada superior
    (55, 272, 130, 292, 110),   # traço vermelho
    (55, 295, 812, 586, 110),   # título
    (58, 586, 652, 680, 175),   # descrição
], solid=[(708, 40, 815, 145)])  # botão de menu
save_webp(m1[0:1540], "home-mobile", [853, 640], quality=82)
# retrato da seção Sobre: o mesmo Marcos, da cabeça ao peito (sem os textos da arte)
save_webp(m1[600:1540], "marcos-retrato", [853, 560])

# 2m e 3m · folhas dos cantos superiores direitos, sem os rótulos das seções
m2 = load("mobile-02-terrenos-valores.png")
m2_folhas = clean(m2, [(546, 98, 822, 136, 120)], blur_px=4)
save_webp(m2_folhas[0:250, 513:852], "folhas-terrenos-mobile", [339])
m3 = load("mobile-03-documentacao.png")
m3_doc = clean(m3, [(56, 1166, 194, 1200, 256)], blur_px=0)
save_webp(m3_doc[575:1250], "documentacao-mobile", [853, 640])
m3_folhas = clean(m3, [(470, 92, 832, 132, 120)], blur_px=4)
save_webp(m3_folhas[0:300, 493:853], "folhas-documentacao-mobile", [360])

# 4m · Dúvidas: céu ao pôr do sol com o marco vermelho, atrás do título HTML
m4 = clean(load("mobile-04-duvidas-contato.png"), [
    (45, 18, 228, 152, 256),    # logo
    (655, 60, 808, 112, 120),   # rótulo da seção e traço
    (48, 168, 728, 342, 110),   # título
    (55, 342, 614, 392, 175),   # descrição
    (38, 634, 214, 666, 256),   # nota
])
save_webp(m4[0:680], "duvidas-mobile", [853, 640], quality=82)

# Logo: recorte justo da referência, fundo escuro convertido em transparência
src = load("01-home.png")[26:160, 112:312]
big = cv2.resize(src, None, fx=3, fy=3, interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
b, g, r = cv2.split(big)
alpha = np.clip(((r - np.maximum(g, b)) - 18) / (170 - 18), 0, 1)
bg = np.array([25, 20, 1], np.float32)  # BGR do fundo atrás da logo
a3 = np.maximum(alpha, 1e-3)[..., None]
rgb = np.clip((big - (1 - a3) * bg) / a3, 0, 255)
ys, xs = np.where(alpha > 0.04)
pad = 6
y0, y1, x0, x1 = max(ys.min() - pad, 0), ys.max() + pad, max(xs.min() - pad, 0), xs.max() + pad
rgba = np.dstack([rgb[..., 2], rgb[..., 1], rgb[..., 0], alpha * 255])[y0:y1, x0:x1].astype(np.uint8)
logo = Image.fromarray(rgba, "RGBA")
logo.save(OUT / "logo-renovato.png", optimize=True)
logo.save(OUT / "logo-renovato.webp", "WEBP", quality=92, method=6)
print(f"logo-renovato  {logo.width}x{logo.height}")

# Ícone da tela inicial (iPhone/Android): logo sobre o fundo azul-petróleo do site
icone = Image.new("RGBA", (180, 180), (1, 23, 28, 255))
mini = logo.resize((140, round(logo.height * 140 / logo.width)), Image.LANCZOS)
icone.alpha_composite(mini, ((180 - mini.width) // 2, (180 - mini.height) // 2))
icone.convert("RGB").save(OUT / "icone-180.png", optimize=True)
print("icone-180.png  180x180")

# Imagem de compartilhamento (WhatsApp, redes): a cena da home em 1200×630 com a logo no lado escuro
og = Image.fromarray(cv2.cvtColor(og_scene, cv2.COLOR_BGR2RGB)).convert("RGBA")
marca = logo.resize((360, round(logo.height * 360 / logo.width)), Image.LANCZOS)
og.alpha_composite(marca, (110, (630 - marca.height) // 2))
og.convert("RGB").save(OUT / "compartilhar.jpg", "JPEG", quality=86, optimize=True)
print("compartilhar.jpg  1200x630")
