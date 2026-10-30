// Animações só com JS ativo; se o script principal não carregar, o conteúdo volta a aparecer.
var root = document.documentElement;
root.classList.add("js");
setTimeout(function () {
  if (!window.__renovatoReady) root.classList.remove("js");
}, 2500);

// Abertura com a logo e o nome: só na página inicial (data-entrada), uma vez por sessão e nunca
// para quem pede menos movimento. Sem sessionStorage disponível, não há abertura.
try {
  if (root.hasAttribute("data-entrada") && !sessionStorage.getItem("renovato-entrada") && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("com-abertura");
    sessionStorage.setItem("renovato-entrada", "1");
    // segurança: se o script principal falhar, a abertura não fica presa na tela
    setTimeout(function () {
      root.classList.remove("com-abertura");
    }, 4000);
  }
} catch (e) {}
