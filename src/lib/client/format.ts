/** Mise en forme partagée par les pages. */

export function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/** Code de récompense lisible à l'oral ou à taper : ABCD-EFGH-JKLM */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
export const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Minuscules sans accents, pour une recherche tolérante. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
