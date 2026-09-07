const individualJidPattern = /^([0-9]{8,30})@(s\.whatsapp\.net|c\.us)$/;

export function normalizeBrazilianPhone(value) {
  if (typeof value !== "string") return null;
  let digits = value.replace(/@.*$/, "").replace(/\D/g, "");

  if (!digits.startsWith("55")) {
    if (digits.length !== 10 && digits.length !== 11) return null;
    digits = `55${digits}`;
  }

  if (digits.length === 12 && /^[6-9]/.test(digits.slice(4, 5))) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }

  return digits.length === 12 || digits.length === 13 ? digits : null;
}

export function normalizeIndividualConversationId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (/^[0-9]{10,13}$/.test(normalized)) {
    const phone = normalizeBrazilianPhone(normalized);
    return phone ? { remoteJid: `${phone}@s.whatsapp.net`, phone } : null;
  }

  const match = individualJidPattern.exec(normalized);
  if (!match) return null;
  const phone = normalizeBrazilianPhone(match[1]);
  return phone ? { remoteJid: normalized, phone } : null;
}
