// Same origin only: every URL is a path. The mock authorization server answers with errors as normal responses, so call() never throws on 4xx.
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString();

export async function getJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function postJson(path, body = {}) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
  return data;
}
export const getCatalog = (vertical) => getJson(`/api/catalog${vertical ? `?vertical=${encodeURIComponent(vertical)}` : ""}`);
export const getBuilder = (client) => getJson(`/api/builder?client=${encodeURIComponent(client)}`);
export const resetServer = () => postJson("/api/reset");
export const runScenario = (scenario, vertical) => postJson("/api/run", { scenario, vertical });
export const getInfo = () => getJson("/api/info");
export const postMode = (source) => postJson("/api/mode", { source });

const REASON = { 200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found" };
export function rawRequest({ method, path, query, headers, bodyText }) {
  const qs = query && Object.keys(query).length ? `?${form(query)}` : "";
  return [`${method} ${path}${qs} HTTP/1.1`, "Host: as.example.invalid", ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join("\n") + (bodyText ? `\n\n${bodyText}` : "");
}
export const rawResponse = (status, headers, body) => `HTTP/1.1 ${status} ${REASON[status] || ""}\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${JSON.stringify(body, null, 2)}`;

// One mock-AS call, recorded in the same shape the server's scenario runner uses for its trace messages.
export async function callMock({ op, label, from, to, method, path, query = {}, body, json = false, headers = {} }) {
  const h = { ...headers };
  let bodyText = null;
  if (body && method !== "GET") {
    bodyText = json ? JSON.stringify(body) : form(body);
    h["content-type"] = json ? "application/json" : "application/x-www-form-urlencoded";
  }
  const qs = Object.keys(query).length ? `?${form(query)}` : "";
  const r = await fetch(`${path}${qs}`, { method, headers: h, body: bodyText ?? undefined });
  const resBody = await r.json().catch(() => ({}));
  const resHeaders = Object.fromEntries([...r.headers.entries()].filter(([k]) => ["content-type", "cache-control", "x-mock", "www-authenticate"].includes(k)));
  return {
    op, label, from, to,
    request: { method, path, query, headers: h, body: body || {}, raw: rawRequest({ method, path, query, headers: h, bodyText }) },
    response: { status: r.status, headers: resHeaders, body: resBody, raw: rawResponse(r.status, resHeaders, resBody) },
  };
}
