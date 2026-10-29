/**
 * Fold text for a forgiving name search: case, Arabic hamza seats (أ إ آ ٱ → ا), taa marbuta
 * (ة → ه), alif maqsura (ى → ي), diacritics and tatweel all stop mattering — "احمد" finds "أحمد",
 * "فاطمه" finds "فاطمة". Both sides of a comparison go through it.
 */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does `haystack` contain `needle`, compared folded? */
export function searchMatches(haystack: string | null | undefined, needle: string): boolean {
  return haystack != null && foldForSearch(haystack).includes(foldForSearch(needle));
}
