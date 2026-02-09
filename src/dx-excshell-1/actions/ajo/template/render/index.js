// File: src/dx-excshell-1/actions/ajo/template/render/index.js

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { requireIms } = require("../../../_lib/ims");

function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function buildGetUrl(params, templateId) {
  const base = params.AJO_GET_TEMPLATE_URL;
  if (!base) return null;
  return `${base}/${templateId}`;
}

function pickEtag(headers = {}) {
  // Depending on fetchRaw implementation, header keys might be normalized
  return headers.etag || headers.ETag || headers["etag"] || headers["ETag"] || null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Attempt to build a "GET fragment by id" URL from existing config.
// Prefer AJO_GET_FRAGMENT_URL if you add it; otherwise derive from AJO_FRAGMENTS_URL.
function buildFragmentGetUrl(params, fragmentId) {
  const base = params.AJO_GET_FRAGMENT_URL;
  if (!base) return null;

  return `${String(base).replace(/\/$/, "")}/${fragmentId}`;
}

async function fetchAjoFragmentContent({ params, authHeader, imsOrg, fragmentId }) {
  const url = buildFragmentGetUrl(params, fragmentId);
  if (!url) {
    const e = new Error("Missing AJO_GET_FRAGMENT_URL for fragment resolution");
    e.status = 500;
    throw e;
  }

  if (!params.AJO_API_KEY) {
    const e = new Error("Missing AJO_API_KEY");
    e.status = 500;
    throw e;
  }
  if (!params.SANDBOX_NAME) {
    const e = new Error("Missing SANDBOX_NAME");
    e.status = 500;
    throw e;
  }

  // NOTE: Accept header may need adjustment depending on your tenant/version.
  // If you see 406/415 errors, we’ll tweak this.
  const resp = await fetchRaw(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      "x-gw-ims-org-id": imsOrg,
      "x-api-key": params.AJO_API_KEY,
      "x-sandbox-name": params.SANDBOX_NAME,
      accept: "application/vnd.adobe.ajo.fragment.v1+json",
    },
  });

  const data = resp?.data || null;
  const content =
    data?.fragment?.content ??
    data?.content ??
    null;

  return {
    id: fragmentId,
    name: data?.name ?? null,
    content,
  };
}

async function inlineAjoFragments({ html, params, authHeader, imsOrg, maxDepth = 5 }) {
  if (!html || typeof html !== "string") return { renderedHtml: html, trace: [] };

  // Match: {{ fragment id="ajo:<uuid>" ... }}
  // Also match single quotes, and allow arbitrary attrs.
  const fragmentCallRe = /{{\s*fragment\s+[^}]*\bid\s*=\s*(["'])ajo:([^"']+)\1[^}]*}}/g;

  const cache = new Map(); // fragmentId -> {id,name,content}
  const trace = [];

  let rendered = html;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const matches = [...rendered.matchAll(fragmentCallRe)];
    if (!matches.length) break;

    // Unique fragment IDs this pass
    const ids = [...new Set(matches.map((m) => m[2]))];

    // Fetch any that aren’t cached
    for (const id of ids) {
      if (cache.has(id)) continue;

      const frag = await fetchAjoFragmentContent({
        params,
        authHeader,
        imsOrg,
        fragmentId: id,
      });

      cache.set(id, frag);

      trace.push({
        type: "ajo-fragment",
        id,
        name: frag.name,
        resolved: Boolean(frag.content),
      });
    }

    // Replace all calls found in this pass
    rendered = rendered.replace(fragmentCallRe, (fullMatch, quote, id) => {
      const frag = cache.get(id);
      if (!frag?.content) {
        // Keep something visible + non-breaking for preview.
        return `<!-- AJO fragment unresolved: ajo:${id} -->`;
      }
      return frag.content;
    });
  }

  return { renderedHtml: rendered, trace };
}

/**
 * V1 "Render" action:
 * - Today: just fetches the template and returns the HTML body.
 * - Later: this is where we'll call resolve fragments + conditional logic and return fully materialized HTML.
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    // Allow "HTML-first" rendering for the demo.
    // If html is provided, we don't need to fetch from AJO.
    const providedHtml =
      typeof params.html === "string"
        ? params.html
        : typeof params.templateHtml === "string"
          ? params.templateHtml
          : typeof params.templateHtml?.body === "string"
            ? params.templateHtml.body
            : typeof params.html?.body === "string"
              ? params.html.body
              : null;

    // If we're going to fetch from AJO, we need IMS context + AJO config.
    const needsFetch = !providedHtml;

    let token, imsOrg;
    if (needsFetch) {
      const ims = requireIms(params);
      token = ims.token;
      imsOrg = ims.imsOrg;
    }

    const templateId = params.templateId || null;

    if (!providedHtml && !templateId) {
      return badRequest("Missing templateId or html");
    }

    let html = providedHtml;
    let etag = null;

    if (!html) {
      if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
      if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");
      if (!params.AJO_GET_TEMPLATE_URL) return serverError("Missing AJO_GET_TEMPLATE_URL");

      const authHeader = normalizeBearer(token);
      const url = buildGetUrl(params, templateId);
      if (!url) return serverError("Could not build template GET url");

      const resp = await fetchRaw(url, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "x-gw-ims-org-id": imsOrg,
          "x-api-key": params.AJO_API_KEY,
          "x-sandbox-name": params.SANDBOX_NAME,
          accept: "application/vnd.adobe.ajo.template.v1+json",
        },
      });

      const data = resp?.data || null;
      html = data?.template?.html?.body ?? data?.template?.html ?? null;

      if (!html) {
        return serverError("Template fetched but no template.html found", {
          templateId,
          keys: data ? Object.keys(data) : null,
        });
      }

      etag = pickEtag(resp?.headers || null);
    }

    // If we have AJO fragment calls, we can inline them for preview.
    // This requires IMS context (token + org) because fragment fetch is authenticated.
    let renderedHtml = html;
    let trace = [];

    const shouldInline =
      params.inlineAjoFragments === true ||
      params.inlineAjoFragments === "true" ||
      // default ON for demo
      params.inlineAjoFragments === undefined;

    if (shouldInline) {
      const ims = requireIms(params);
      const authHeader = normalizeBearer(ims.token);

      const stitched = await inlineAjoFragments({
        html,
        params,
        authHeader,
        imsOrg: ims.imsOrg,
        maxDepth: Number(params.maxInlineDepth || 5),
      });

      renderedHtml = stitched.renderedHtml;
      trace = stitched.trace;
    }

  return ok({
    templateId,
    html,            // original (pre-stitch)
    renderedHtml,    // stitched (AJO fragments inlined)
    etag,
    trace,           // what got resolved
  });
  } catch (e) {
    return serverError(e.message, {
      url: e.url,
      status: e.status,
      responseText: e.responseText,
      data: e.data,
    });
  }
}

exports.main = main;