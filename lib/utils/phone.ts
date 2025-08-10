// /lib/utils/phone.ts
export function phoneVariants(input: string) {
  const raw = String(input).replace(/[^\d+]/g, ""); // "62895..." atau "+62895..."
  let e164 = raw;
  if (e164.startsWith("0")) e164 = "+62" + e164.slice(1);
  else if (e164.startsWith("62") && !e164.startsWith("+"))
    e164 = "+" + e164; // "62..." -> "+62..."
  else if (!e164.startsWith("+") && /^\d+$/.test(e164))
    e164 = "+62" + e164.replace(/^0/, "");

  const local = e164.replace(/^\+62/, "0"); // "0895..."
  const intlNoPlus = e164.replace(/^\+/, ""); // "62895..."
  return { raw, e164, local, intlNoPlus };
}
