# Gera as fotos dos anúncios a partir de data/imoveis.json (campo "origem" de cada foto).
# Uso: npm run fotos
#   arquivo   → foto grande em WebP, na largura original (até 1600 px), usada na galeria e na ampliação
#   miniatura → 240 px de largura, para a faixa de miniaturas
# As fotos não são editadas (sem recorte, retoque ou filtro); os metadados (EXIF/GPS) são descartados.
import json
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
dados = json.loads((ROOT / "data" / "imoveis.json").read_text(encoding="utf-8"))

for im in dados["imoveis"]:
    for f in im.get("fotos", []):
        origem = f.get("origem")
        if not origem:
            continue
        src = ImageOps.exif_transpose(Image.open(ROOT / origem)).convert("RGB")
        grande = src if src.width <= 1600 else src.resize((1600, round(src.height * 1600 / src.width)), Image.LANCZOS)
        mini = src.resize((240, round(src.height * 240 / src.width)), Image.LANCZOS)
        for destino, img, q in [(f["arquivo"], grande, 78), (f["miniatura"], mini, 78)]:
            out = ROOT / destino
            out.parent.mkdir(parents=True, exist_ok=True)
            img.save(out, "WEBP", quality=q, method=6)
        if (f.get("largura"), f.get("altura")) != grande.size:
            print(f"  atenção: {f['arquivo']} tem {grande.size[0]}x{grande.size[1]}; atualize largura/altura no JSON")
        print(f"{f['arquivo']}  {grande.width}x{grande.height}  {(ROOT / f['arquivo']).stat().st_size // 1024} KB  (mini {(ROOT / f['miniatura']).stat().st_size // 1024} KB)")
