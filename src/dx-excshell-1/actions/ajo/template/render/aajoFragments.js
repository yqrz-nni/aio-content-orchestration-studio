// File: src/dx-excshell-1/actions/ajo/template/render/utils.js

function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function buildCommonHeaders({ authHeader, imsOrg, apiKey, sandboxName }) {
  return {
    Authorization: authHeader,
    "x-gw-ims-org-id": imsOrg,
    "x-api-key": apiKey,
    "x-sandbox-name": sandboxName,
  };
}

function pickEtag(headers = {}) {
  return headers.etag || headers.ETag || headers["etag"] || headers["ETag"] || null;
}

function stripAjoPrefix(id) {
  if (!id || typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.startsWith("ajo:") ? trimmed.slice("ajo:".length) : trimmed;
}

function buildFragmentGetUrl(baseUrl, fragmentId) {
  if (!baseUrl) return null;

  const u = new URL(baseUrl);
  u.search = "";
  u.hash = "";

  const basePath = u.pathname.replace(/\/$/, "");
  u.pathname = `${basePath}/${encodeURIComponent(fragmentId)}`;

  return u.toString();
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeJsonSnippet(obj, maxChars = 1200) {
  try {
    const s = JSON.stringify(obj);
    return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
  } catch {
    return String(obj);
  }
}

/**
 * Simple concurrency limiter (no deps).
 * Runs `items` through `worker(item)` with at most `limit` in flight.
 * Preserves result order by index.
 */
async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const n = list.length;
  if (!n) return [];

  const lim = Math.max(1, Number(limit || 1));
  const out = new Array(n);

  let next = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const launch = () => {
      while (active < lim && next < n) {
        const idx = next++;
        active++;

        Promise.resolve()
          .then(() => worker(list[idx], idx))
          .then((res) => {
            out[idx] = res;
            active--;
            if (next >= n && active === 0) resolve(out);
            else launch();
          })
          .catch(reject);
      }
    };

    launch();
  });
}

module.exports = {
  normalizeBearer,
  buildCommonHeaders,
  pickEtag,
  stripAjoPrefix,
  buildFragmentGetUrl,
  escapeRegExp,
  safeJsonSnippet,
  mapLimit,
};