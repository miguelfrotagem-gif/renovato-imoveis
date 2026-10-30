// Dados profissionais e comerciais da Renovato Imóveis — único lugar para editar.
// Depois de alterar, rode `npm run build`: ele copia links e textos marcados para as páginas HTML
// (assim os links funcionam mesmo sem JavaScript). O site também aplica estes valores ao carregar.
// Se `whatsappNumber` ficar vazio, os botões mostram `fallbackMessage` em vez de abrir um link inválido.
// Os anúncios ficam em data/imoveis.json (veja o README).
const phone = "+5511925993517"; // formato internacional, usado em tel:

export const site = {
  brand: "Renovato Imóveis",
  owner: "Marcos", // tratamento nas mensagens
  ownerName: "Marcos Schiripa", // nome de apresentação
  ownerFullName: "Marcos Roberto Schiripa",
  role: "Corretor de imóveis independente",
  creci: "CRECI 330533/SP", // informado pelo próprio corretor
  region: "Atibaia e região",
  email: "marcos.schiripa@creci.org.br",
  phone,
  phoneDisplay: "+55 11 92599-3517",
  whatsappNumber: phone.replace(/\D/g, ""),
  instagram: { handle: "@marcos.schiripa", url: "https://www.instagram.com/marcos.schiripa/" },
  // Facebook informado como "Marcos Schiripa Corretor", sem URL confirmada: fica fora do site até ela existir.
  facebook: null,

  // Endereço público do site, usado nos links de detalhes enviados pelo WhatsApp.
  siteUrl: "https://marcoscorretor-chi.vercel.app",

  // Mensagens abertas no WhatsApp, por botão (data-wa="..."). data-wa="" abre a conversa sem texto.
  // As mensagens de cada imóvel são montadas em js/imoveis.js a partir do anúncio.
  messages: {
    home: "Olá, Marcos! Vi o site da Renovato Imóveis e gostaria de conhecer os imóveis disponíveis em Atibaia e região.",
    menu: "Olá, Marcos! Gostaria de conhecer os imóveis disponíveis na Renovato Imóveis.",
    imoveis: "Olá, Marcos! Gostaria de receber as opções de imóveis disponíveis em Atibaia e região.",
    documentacao: "Olá, Marcos! Tenho interesse em um terreno e gostaria de saber mais sobre a documentação.",
    visita: "Olá, Marcos! Gostaria de conversar sobre os imóveis disponíveis e combinar uma visita.",
  },

  // Versão da Política de Privacidade (a data de atualização publicada na página).
  // Mudou a política de forma relevante? Atualize a data aqui e na página: o aviso volta a aparecer.
  policyVersion: "2026-10-28",

  fallbackMessage: "O atendimento pelo WhatsApp será disponibilizado em breve. Obrigado pelo interesse!",
};
