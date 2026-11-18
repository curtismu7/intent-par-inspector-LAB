// Decode only. The page never verifies or signs anything: tokens come from the mock authorization server.
// Rule 24b: segment decoding is the shared pane's; this keeps the lab's null-on-error shape.
import { decodeSegment } from "../components/JsonPane.jsx";
export function decodeJwt(token) {
  try {
    const [h, p, s] = String(token).split(".");
    const header = decodeSegment(h);
    const payload = decodeSegment(p);
    if (!header || !payload) return null;
    return { header, payload, signature: s };
  } catch { return null; }
}
// Claims that carry the bound intent: highlighted in the token panel.
export const INTENT_CLAIMS = ["intent", "authorization_details", "intent_hash", "binding"];
