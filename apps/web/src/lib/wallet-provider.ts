/**
 * Which Egyptian mobile wallet a number belongs to, from its network prefix — so a payer sees
 * "Vodafone Cash" beside 010…, not a bare number. Any other number is just a wallet number.
 * Used by the public payment page and by Settings → Payment methods.
 */
export function walletProvider(number: string): { en: string; ar: string } {
  let digits = number.replace(/\D/g, "");
  if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 11) {
    if (digits.startsWith("010")) return { en: "Vodafone Cash", ar: "فودافون كاش" };
    if (digits.startsWith("011")) return { en: "Etisalat Cash", ar: "اتصالات كاش" };
    if (digits.startsWith("012")) return { en: "Orange Cash", ar: "أورانج كاش" };
    if (digits.startsWith("015")) return { en: "WE Pay", ar: "وي باي" };
  }
  return { en: "Wallet number", ar: "رقم المحفظة" };
}
