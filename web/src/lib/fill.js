// {{cast}} tokens in UI copy and story text: {{user}}, {{agent}}, {{merchant}}, {{item}}. Unknown tokens stay visible.
export function fill(text, cast = {}) {
  return String(text ?? "").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in cast ? String(cast[k]) : m));
}
