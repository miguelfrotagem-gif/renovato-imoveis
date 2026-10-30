// Funções puras de WhatsApp (usadas pelo site e pelos testes em Node).

/** Número utilizável no wa.me (10 a 15 dígitos) ou null. */
export function normalizeNumber(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** Link wa.me com a mensagem codificada, ou null quando não há número configurado. */
export function waLink(rawNumber, message = "") {
  const number = normalizeNumber(rawNumber);
  if (!number) return null;
  return message ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : `https://wa.me/${number}`;
}
