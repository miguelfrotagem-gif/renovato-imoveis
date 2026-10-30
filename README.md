# Renovato Imóveis — Marcos Schiripa, corretor de imóveis em Atibaia e região

HTML, CSS e JavaScript puros, sem dependências externas.

## Rodar

```
npm run build      # copia contatos e dados profissionais de js/config.js para as páginas HTML
npm start          # http://localhost:5190
npm test           # conteúdo, contatos sincronizados, anúncios (data/imoveis.json), filtros, mensagens, política, CSP
npm run verify     # Chrome headless: 18 viewports, menus, catálogo/filtros/detalhes/galeria, FAQ, contatos,
                   # aviso de privacidade, política, rede/cookies/armazenamento, teclado,
                   # movimento reduzido, sem JS, texto 150%
npm run images     # regenera assets/img a partir de referencias/ (Python + Pillow + OpenCV)
```

`npm run verify` precisa do servidor rodando e salva screenshots e `relatorio.json` em `capturas/`.
Para checar o site publicado: `BASE=https://marcoscorretor-chi.vercel.app/ node tools/verify.mjs`.

## Dados profissionais e contatos

Ficam todos em `js/config.js`: nome, CRECI, região, WhatsApp, telefone, e-mail, Instagram, endereço público do
site (`siteUrl`, usado nos links enviados pelo WhatsApp) e as mensagens de cada botão.
Depois de editar, rode `npm run build`: links e textos marcados (`data-wa`, `data-contact`, `data-site`) ficam
gravados no HTML, então funcionam mesmo sem JavaScript. O `npm test` falha se alguma página ficar diferente.

O Facebook só entra no site quando houver uma URL confirmada (`facebook` em `js/config.js`).

## Anúncios de imóveis (edição manual, sem painel)

Os anúncios ficam em **`data/imoveis.json`**. O catálogo da página inicial e a página de detalhes
(`/imovel/?id=...`) leem esse arquivo; não é preciso mexer no layout para adicionar ou retirar imóveis.
O modelo comentado de um anúncio está em `data/imoveis.exemplo.json` (não é publicado).

Campos de cada anúncio:

| Campo | Obrigatório | Observação |
| --- | --- | --- |
| `id` | sim | letras minúsculas, números e hífens; vira o endereço `/imovel/?id=casa-centro` |
| `referencia` | não | código do anúncio, aparece nos detalhes e na mensagem do WhatsApp |
| `publicado` | sim | só `true` aparece no site; `false` guarda o anúncio sem mostrar |
| `titulo`, `tipo`, `cidade` | sim | tipo: Terreno, Casa, Apartamento, Chácara ou Sítio |
| `bairro` | não | |
| `preco` | não | número em reais (`650000`); `null` mostra "Valor sob consulta" (nunca use 0) |
| `areas` | não | lista de `{ "rotulo": "Área do terreno", "m2": 360 }` |
| `quartos`, `banheiros`, `vagas` | não | ignorados em terrenos |
| `caracteristicas` | não | lista de textos confirmados (inclusive sobre documentação, quando houver) |
| `descricao` | não | parágrafos separados por linha em branco (`\n\n`) |
| `fotos` | sim | lista na ordem de exibição (a primeira é a capa), cada uma com `origem` (foto original em `materiais/`), `arquivo` e `miniatura` (gerados), `largura`/`altura`, `foco` (enquadramento na galeria, ex. `"50% 40%"`) e `alt` |

Um anúncio marcado como publicado, mas sem `id`, `titulo`, `tipo`, `cidade` ou pelo menos uma foto com
texto alternativo, não aparece (o navegador avisa no console e o `npm test` falha).

**Adicionar um imóvel**
1. Coloque as fotos originais numa pasta própria em `materiais/` (ex.: `materiais/terreno-03/`), com um
   `INFORMACOES.txt` do que foi recebido. `materiais/` não é publicado.
2. Copie um bloco para `data/imoveis.json`, troque os dados, aponte `origem` de cada foto e use `"publicado": true`.
3. Rode `npm run fotos` (gera a foto grande e a miniatura em `assets/imoveis/<id>/`, sem metadados), depois
   `npm run build` e `npm test`, e confira em `npm start`.

**Retirar um imóvel**: mude `"publicado"` para `false` (ou apague o bloco). Se apagar, pode remover a pasta de fotos.

**Publicar a atualização**: `npm test` e `npm run verify`, depois `vercel deploy --prod --yes` na pasta do projeto.

A seção mostra só anúncios do tipo `Terreno`, cada um numa apresentação com galeria própria (setas, miniaturas,
deslizar no celular, "Ampliar fotos"). O controle "Qual é o seu orçamento?" vai de R$ 0 a R$ 270.000, de R$ 1.000
em R$ 1.000 (`ORCAMENTO` em `js/imoveis.js`), e mostra os terrenos com preço menor ou igual ao valor escolhido.
Terreno sem preço ou acima do teto nunca aparece nesse controle: o navegador avisa no console, e vale ajustar o
teto em vez de mexer no preço.

## Páginas

- `/`: Início, Imóveis, Documentação (a seção da primeira versão), Sobre Marcos e Dúvidas e contato.
- `/imovel/?id=<id>`: detalhes e galeria de um anúncio (`imovel/index.html`, `js/detalhe.js`, `css/imovel.css`).
- `/politica-de-privacidade`: `politica-de-privacidade/index.html`. Revise o texto se o site ganhar formulário,
  cookies, analytics ou outro serviço externo. Funciona com e sem barra final; `vercel.json` (`cleanUrls`) cobre a Vercel.

- `404.html`: página da marca para endereços inexistentes (a Vercel e o `server.mjs` a entregam com status 404).

## Compartilhamento e buscadores

- As tags `og:*` (prévia no WhatsApp e nas redes) usam `assets/img/compartilhar.jpg` (1200×630, gerada por
  `npm run images`). Endereços absolutos vêm de `siteUrl` em `js/config.js` (atributo `data-url`, preenchido pelo build).
- `npm run build` gera `sitemap.xml` (páginas fixas + cada anúncio publicado) e `robots.txt`. Rode o build sempre
  que mudar `data/imoveis.json` ou o domínio.

## Abertura

Na primeira visita de cada sessão, a página inicial mostra por ~3 s a logo e o nome (`ownerName` em
`js/config.js`). `js/boot.js` decide (classe `com-abertura` no `<html>`, marcação `renovato-entrada` em
`sessionStorage`); não aparece com movimento reduzido nem sem JavaScript, e um toque ou tecla pula.
A entrada da hero e o aviso de privacidade esperam a abertura terminar.

## Aviso de privacidade

Aparece na primeira visita (800 ms após o carregamento). "Aceitar e continuar" grava em `localStorage`
(`renovato-aviso-privacidade`) só `{ versao, data }`; "Agora não" e o X gravam uma marcação em `sessionStorage`.
Isso controla apenas a exibição do aviso: não ativa nada. Ao revisar a política de forma relevante, mude a data
na página e em `policyVersion` (`js/config.js`): o aviso volta a aparecer para todos.

## Menu mobile

Camada clara de tela inteira (`.mmenu`) com dois blocos brancos (logo + fechar; navegação + "Falar com Marcos"),
direto no `body`: o cabeçalho tem `container-type` e animação de entrada, que limitariam um elemento fixo dentro
dele. Estilos próprios (`.mmenu-*`, `.menu-link`), separados da navegação desktop (`.nav-list`, `.nav-link`).

## Acabamento visual (tokens e referências)

Tokens compartilhados no `:root` de `css/styles.css`: cores (`--red`, `--petrol`, `--paper*`), raios (`--r-sm/md/lg/pill`),
borda (`--border-dark`), sombras (`--shadow-1/2`) e tempos (`--t-fast` 200 ms para interações, `--t-enter` 550 ms e
`--rise` 16 px para entradas). Variantes de ação: `.btn-red` (primário), `.btn-ghost` (secundário com borda) e
`.link-anim` (link textual).

Padrões visuais inspirados em componentes do 21st.dev, **reproduzidos do zero em HTML/CSS/JS** (o código-fonte deles
exige chave de API; nenhum código foi copiado, por isso não há avisos de licença a preservar):
- Menu desktop com sublinhado deslizante — "Underlined Navigation Menu" (shadcnui-blocks, MIT).
- Cards dos anúncios — "Property Preview Card" (ShadcnSpace, MIT).
- Botão com gradiente que desliza na interação — "Animated Gradient Button" (uiable, MIT).
- FAQ com indicador circular — "FAQ" (Kokonut UI, MIT).
- Link com sublinhado que entra da esquerda e seta diagonal — "Animated Link" (Ruixen UI, licença não informada).

## Desktop e mobile

O desktop (≥ 900px e paisagem) segue `RENOVATO_REFERENCIA_DESKTOP.pdf`; abaixo disso vale a composição de
`RENOVATO_REFERENCIA_MOBILE.pdf`, num bloco próprio no fim de `css/styles.css`. Fotos com recorte próprio de
cada referência entram por `<picture>`.

## Arquivos

- `referencias/`: as telas extraídas dos PDFs em resolução original (intactas).
- `originais/`: os PDFs de referência (desktop e mobile).
- `assets/img/`: recortes das referências (hero, retrato de Marcos, céu do FAQ, folhas) e a logo. São imagens da
  marca: não use como foto de imóvel anunciado.
- `assets/imoveis/`: fotos reais dos anúncios, uma pasta por `id`.
- `assets/fonts/`: Source Serif 4 e Inter, servidas localmente.
