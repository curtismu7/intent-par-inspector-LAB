// Decode only. The page never verifies or signs anything: tokens come from the mock authorization server.
const b64 = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export function decodeJwt(token) {
  try {
    const [h, p, s] = String(token).split(".");
    return { header: JSON.parse(b64(h)), payload: JSON.parse(b64(p)), signature: s };
  } catch { return null; }
}
// Claims that carry the bound intent: highlighted in the token panel.
export const INTENT_CLAIMS = ["intent", "authorization_details", "intent_hash", "binding"];
