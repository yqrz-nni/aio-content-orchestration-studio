// File: src/dx-excshell-1/actions/ajo/template/render/index.js

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { fetchJson } = require("../../../_lib/fetchJson");
const { requireIms } = require("../../../_lib/ims");
const auth = require("@adobe/jwt-auth");

/**
 * Normalize Bearer token for Authorization header.
 */
function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/**
 * Build common IMS/AEP gateway headers.
 */
function buildCommonHeaders({ authHeader, imsOrg, apiKey, sandboxName }) {
  return {
    Authorization: authHeader,
    "x-gw-ims-org-id": imsOrg,
    "x-api-key": apiKey,
    "x-sandbox-name": sandboxName,
  };
}

/**
 * Return ETag from response headers (fetchRaw lowercases keys).
 */
function pickEtag(headers = {}) {
  return headers.etag || headers.ETag || headers["etag"] || headers["ETag"] || null;
}

/**
 * Some AJO HTML embeds fragment ids like "ajo:<uuid>".
 * REST endpoint is /fragments/<uuid> (no "ajo:" prefix).
 */
function stripAjoPrefix(id) {
  if (!id || typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.startsWith("ajo:") ? trimmed.slice("ajo:".length) : trimmed;
}

/**
 * Build a clean GET-by-id URL from a base that might include query params.
 * Example base:
 *   https://platform.adobe.io/ajo/content/fragments?orderBy=-modifiedAt&limit=20
 * For GET-by-id we must drop query params:
 *   https://platform.adobe.io/ajo/content/fragments/<id>
 */
function buildFragmentGetUrl(baseUrl, fragmentId) {
  if (!baseUrl) return null;

  const u = new URL(baseUrl);
  u.search = "";
  u.hash = "";

  const basePath = u.pathname.replace(/\/$/, "");
  u.pathname = `${basePath}/${encodeURIComponent(fragmentId)}`;

  return u.toString();
}

/**
 * Find AJO fragment ids referenced in template HTML.
 * Matches:
 *  - {{ fragment id="ajo:<uuid>" ... }}
 *  - {{fragment id='ajo:<uuid>' ...}}
 * Returns array of raw ids like "ajo:<uuid>".
 */
function extractAjoFragmentIds(html) {
  if (!html || typeof html !== "string") return [];

  const ids = new Set();
  const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])(ajo:[^'"]+)\1/gi;

  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[2]) ids.add(m[2]);
  }

  return [...ids];
}

/**
 * Fetch a single fragment detail (GET /fragments/<id>) and return useful fields.
 */
async function fetchFragmentById({ baseUrl, fragmentIdRaw, headers }) {
  const cleanId = stripAjoPrefix(fragmentIdRaw);
  if (!cleanId) {
    const e = new Error(`Invalid fragment id: ${fragmentIdRaw}`);
    e.status = 400;
    throw e;
  }

  const url = buildFragmentGetUrl(baseUrl, cleanId);
  if (!url) {
    const e = new Error("Missing AJO_GET_FRAGMENT_URL");
    e.status = 500;
    throw e;
  }

  const resp = await fetchRaw(url, {
    method: "GET",
    headers: {
      ...headers,
      accept: "application/vnd.adobe.ajo.fragment.v1.0+json",
    },
  });

  return {
    id: resp?.data?.id || cleanId,
    name: resp?.data?.name || null,
    type: resp?.data?.type || null,
    channels: resp?.data?.channels || null,
    content:
      resp?.data?.fragment?.content ??
      resp?.data?.fragment?.processedContent ??
      resp?.data?.fragment?.expression ??
      resp?.data?.fragment?.content?.expression ??
      null,
  };
}

/**
 * Always resolve fragment details referenced in html.
 */
async function resolveFragmentsFromHtml({ html, params, commonHeaders }) {
  const resolutionWarnings = [];
  let fragmentsResolved = [];

  if (!params.AJO_GET_FRAGMENT_URL) {
    return {
      fragmentsResolved,
      resolutionWarnings: ["AJO_GET_FRAGMENT_URL is missing (cannot resolve fragments)."],
    };
  }

  const fragmentIds = extractAjoFragmentIds(html);

  const max = Number(params.maxFragmentsToResolve || 10);
  const toResolve = fragmentIds.slice(0, Math.max(0, max));

  const results = [];
  for (const fid of toResolve) {
    try {
      const frag = await fetchFragmentById({
        baseUrl: params.AJO_GET_FRAGMENT_URL,
        fragmentIdRaw: fid,
        headers: commonHeaders,
      });
      results.push(frag);
    } catch (e) {
      resolutionWarnings.push(`Failed to resolve fragment ${fid}: ${e.message}`);
    }
  }

  fragmentsResolved = results;

  if (fragmentIds.length > toResolve.length) {
    resolutionWarnings.push(
      `Resolved ${toResolve.length}/${fragmentIds.length} fragments (capped by maxFragmentsToResolve=${max}).`
    );
  }

  return { fragmentsResolved, resolutionWarnings };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace {{ fragment id="ajo:..." ... }} occurrences with resolved HTML.
 * We replace the entire handlebars tag, not the surrounding comments.
 */
function stitchFragmentsIntoHtml(html, fragmentsResolved) {
  if (!html || !Array.isArray(fragmentsResolved) || fragmentsResolved.length === 0) {
    return html;
  }

  let out = html;

  for (const frag of fragmentsResolved) {
    const rawId = `ajo:${frag.id}`;
    const replacement = frag.content || "";

    const re = new RegExp(
      `{{\\s*fragment\\b[^}]*\\bid\\s*=\\s*(['"])${escapeRegExp(rawId)}\\1[^}]*}}`,
      "gi"
    );

    out = out.replace(re, replacement);
  }

  return out;
}

/**
 * Resolve + stitch recursively up to a max depth (handles nested fragments).
 * Returns:
 *  - stitchedHtml
 *  - fragmentsResolvedAll (deduped by id)
 *  - resolutionWarnings
 */
async function resolveAndStitchRecursively({ html, params, commonHeaders }) {
  const maxDepth = Number(params.maxFragmentDepth || 3);

  let currentHtml = html;
  let allWarnings = [];
  const byId = new Map();

  for (let depth = 0; depth < maxDepth; depth++) {
    const { fragmentsResolved, resolutionWarnings } = await resolveFragmentsFromHtml({
      html: currentHtml,
      params,
      commonHeaders,
    });

    allWarnings = allWarnings.concat(resolutionWarnings || []);

    if (!fragmentsResolved || fragmentsResolved.length === 0) break;

    let anyNew = false;
    for (const f of fragmentsResolved) {
      if (f && f.id && !byId.has(f.id)) {
        byId.set(f.id, f);
        anyNew = true;
      }
    }

    const nextHtml = stitchFragmentsIntoHtml(currentHtml, fragmentsResolved);

    if (nextHtml === currentHtml) break;

    currentHtml = nextHtml;

    if (!anyNew && depth > 0) break;
  }

  return {
    stitchedHtml: currentHtml,
    fragmentsResolvedAll: [...byId.values()],
    resolutionWarnings: allWarnings,
  };
}

/* ------------------------------------------------------------------ */
/* AEM BIND TAG PARSING (order-preserving)                              */
/* ------------------------------------------------------------------ */

/**
 * Parse "aem:<uuid>?repoId=..." into { aemId, repoId }.
 */
function parseAemIdRaw(aemIdRaw) {
  if (!aemIdRaw || typeof aemIdRaw !== "string") return { aemId: null, repoId: null };

  const trimmed = aemIdRaw.trim();
  const [beforeQ, qs] = trimmed.split("?");

  const aemId = beforeQ.startsWith("aem:") ? beforeQ.slice("aem:".length) : beforeQ;

  let repoId = null;
  if (qs) {
    const sp = new URLSearchParams(qs);
    repoId = sp.get("repoId");
  }

  return { aemId, repoId };
}

/**
 * Parse extra key=value args from the inner fragment tag.
 * Example: result='cf' r1=r1 r2=r2 => { r1: "r1", r2: "r2" }
 */
function parseAemCallArgs(inner) {
  const args = {};
  if (!inner) return args;

  const kvRe = /\b([a-zA-Z_][\w.-]*)\s*=\s*(?:(['"])(.*?)\2|([^\s}]+))/g;
  let m;
  while ((m = kvRe.exec(inner)) !== null) {
    const key = m[1];
    const quotedVal = m[3];
    const bareVal = m[4];

    if (key === "id" || key === "result" || key === "mode" || key === "name") continue;

    args[key] = quotedVal != null ? quotedVal : bareVal;
  }

  return args;
}

/**
 * Extract AEM binding fragment calls in document order.
 *
 * Supports:
 *  {{fragment id='aem:<uuid>?repoId=...' result='cf' r1=r1 ...}}
 *  {{ fragment id="aem:<uuid>?repoId=..." result="prbProperties" }}
 *
 * Returns [{ raw, aemId, result, repoId, args, start, end, index }]
 */
function extractAemBindingsInOrder(html) {
  if (!html || typeof html !== "string") return [];

  const out = [];
  const tagRe = /{{\s*fragment\b([\s\S]*?)}}/gi;

  let m;
  let index = 0;

  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const inner = m[1] || "";
    const start = m.index;
    const end = start + full.length;

    const idMatch = inner.match(/\bid\s*=\s*(['"])(aem:[^'"]+)\1/i);
    if (!idMatch) continue;

    const idRaw = idMatch[2];
    if (!idRaw.toLowerCase().startsWith("aem:")) continue;

    const resultMatch = inner.match(/\bresult\s*=\s*(['"])([^'"]+)\1/i);
    const result = resultMatch ? resultMatch[2] : null;

    const parsed = parseAemIdRaw(idRaw);
    const args = parseAemCallArgs(inner);

    out.push({
      raw: full,
      aemIdRaw: idRaw,
      aemId: parsed.aemId,
      repoId: parsed.repoId,
      result,
      args,
      start,
      end,
      index: index++,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* AEM GRAPHQL FETCH (optional prefetch, cached)                        */
/* ------------------------------------------------------------------ */

function buildAemGqlUrl(params) {
  const useProxy = params.USE_AEM_PROXY === "true";

  if (!params.AEM_GQL_PATH) throw new Error("Missing AEM_GQL_PATH");
  if (!params.AEM_AUTHOR && !useProxy) throw new Error("Missing AEM_AUTHOR");
  if (!params.AEM_GQL_PATH_PROXY && useProxy) throw new Error("Missing AEM_GQL_PATH_PROXY");

  return useProxy
    ? params.AEM_GQL_PATH_PROXY
    : new URL(params.AEM_GQL_PATH, params.AEM_AUTHOR).toString();
}

async function buildAemHeaders(params) {
  const useProxy = params.USE_AEM_PROXY === "true";
  const headers = { "content-type": "application/json" };
  if (useProxy) return headers;

  const required = [
    "IMS_HOST",
    "CLIENT_ID",
    "CLIENT_SECRET",
    "TECH_ACCOUNT_ID",
    "ORG_ID",
    "PRIVATE_KEY",
    "METASCOPES",
  ];
  for (const k of required) {
    if (!params[k]) throw new Error(`Missing ${k}`);
  }

  const accessTokenResp = await auth({
    imsHost: params.IMS_HOST,
    clientId: params.CLIENT_ID,
    clientSecret: params.CLIENT_SECRET,
    technicalAccountId: params.TECH_ACCOUNT_ID,
    orgId: params.ORG_ID,
    privateKey: (params.PRIVATE_KEY || "").replace(/\\r\\n/g, "\n"),
    metaScopes: params.METASCOPES,
  });

  const accessToken = accessTokenResp.access_token || accessTokenResp;

  headers.Authorization = `Bearer ${accessToken}`;
  headers["x-gw-ims-org-id"] = params.ORG_ID;
  headers["x-api-key"] = params.CLIENT_ID;

  return headers;
}

/**
 * Fetch AEM item by GraphQL using the explicit model queries you shared.
 * model: "prb" | "unifiedpromo"
 */
async function fetchAemItemViaGraphql({ model, aemId, params }) {
  const url = buildAemGqlUrl(params);
  const headers = await buildAemHeaders(params);

  const query =
    model === "prb"
      ? `
        query GetFragmentById($id: String!) {
          prbPropertiesById(_id:$id) {
            item {
              _id
              _path
              name
              prbNumber
              startingDate
              expirationDate
              brandStyle {
                font_family
                email_banner_content_section_padding
                email_banner_content_bottom_margin
                email_banner_content_top_margin
                email_banner_content_right_margin
                email_banner_content_left_margin
                email_body_copy_line_height
                email_headline_line_height
                font_size_heading_xs
                font_size_heading_sm
                font_size_heading_med
                font_size_heading_lg
                font_size_heading_x1
                component_button_border_radius
                divider_weight
                divider_color
                color_text_body
                color_text_white
                color_text_link_secondary
                color_text_link_primary
                color_background_tertiary
                color_background_secondary
                color_background_primary
                color_text_tertiary
                color_text_secondary
                color_text_primary
              }
              brands {
                isiLink
                piLink
                indication
                homepageUrl
                icon
                displayName
                name
              }
            }
          }
        }
      `
      : `
        query GetFragmentById($id: String!) {
          unifiedPromotionalContentById(_id:$id) {
            item {
              _id
              _path
              eyebrowText
              headlineText
              bodyCopy
              primaryImage
              ctaText
              ctaLink
              localFootnote
              references { referenceNote }
              localReferences { referenceNote }
            }
          }
        }
      `;

  const data = await fetchJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: { id: aemId } }),
  });

  if (data?.errors?.length) {
    const e = new Error("AEM GraphQL returned errors");
    e.status = 502;
    e.data = data;
    throw e;
  }

  const item =
    model === "prb"
      ? data?.data?.prbPropertiesById?.item
      : data?.data?.unifiedPromotionalContentById?.item;

  return item || null;
}

/**
 * Cached AEM fetch.
 * cacheKey: "prb:<id>" | "unifiedpromo:<id>"
 */
async function fetchAemItemCached({ cache, binding, params }) {
  const { result, aemId } = binding;
  if (!result || !aemId) return null;

  const model = result === "prbProperties" ? "prb" : result === "cf" ? "unifiedpromo" : null;
  if (!model) return null;

  const key = `${model}:${aemId}`;
  if (cache.has(key)) return cache.get(key);

  const item = await fetchAemItemViaGraphql({ model, aemId, params });
  cache.set(key, item);
  return item;
}

/**
 * Render action:
 * Supports TWO modes:
 * 1) HTML mode (TemplateStudio preview): params.html
 * 2) templateId mode: fetch template from AJO by params.templateId
 *
 * Fragment resolution is ALWAYS ON, and we also return stitchedHtml.
 *
 * NEW:
 * - Parse AEM binding tags in-order (cf/prbProperties)
 * - Optional prefetch + cache (for now, returns debug payload)
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const { token, imsOrg } = requireIms(params);
    const authHeader = normalizeBearer(token);

    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const commonHeaders = buildCommonHeaders({
      authHeader,
      imsOrg,
      apiKey: params.AJO_API_KEY,
      sandboxName: params.SANDBOX_NAME,
    });

    const templateId = typeof params.templateId === "string" ? params.templateId : null;

    // For AEM: allow caller to disable prefetch until env vars are wired.
    const prefetchAem = params.prefetchAem !== false && params.prefetchAem !== "false";

    async function postProcessStitched(stitchedHtml) {
      // Discover bind tags (document order)
      const bindings = extractAemBindingsInOrder(stitchedHtml);

      // Prefetch (optional) with caching
      const cache = new Map();
      const aemPrefetch = [];
      const aemWarnings = [];

      if (prefetchAem && bindings.length) {
        for (const b of bindings) {
          // Only your known models for now
          if (b.result !== "cf" && b.result !== "prbProperties") continue;

          try {
            const item = await fetchAemItemCached({ cache, binding: b, params });
            aemPrefetch.push({
              index: b.index,
              result: b.result,
              aemId: b.aemId,
              ok: !!item,
            });
          } catch (e) {
            aemWarnings.push(`Failed to fetch AEM ${b.result} ${b.aemId}: ${e.message}`);
            aemPrefetch.push({
              index: b.index,
              result: b.result,
              aemId: b.aemId,
              ok: false,
            });
          }
        }
      }

      return {
        aemBindingsEncountered: bindings.map((b) => ({
          index: b.index,
          result: b.result,
          aemId: b.aemId,
          repoId: b.repoId,
          args: b.args,
        })),
        aemPrefetch,
        aemCacheKeys: [...cache.keys()],
        aemWarnings,
      };
    }

    // -------- Mode A: HTML provided directly (current UI behavior) --------
    if (typeof params.html === "string" && params.html.trim()) {
      const html = params.html;

      const stitched = await resolveAndStitchRecursively({ html, params, commonHeaders });
      const aemDebug = await postProcessStitched(stitched.stitchedHtml);

      return ok({
        mode: "html",
        templateId,
        html,
        stitchedHtml: stitched.stitchedHtml,
        etag: null,
        fragmentsResolved: stitched.fragmentsResolvedAll,
        resolutionWarnings: stitched.resolutionWarnings,

        // NEW:
        ...aemDebug,
      });
    }

    // -------- Mode B: templateId fetch from AJO --------
    if (!templateId) return badRequest("Missing templateId or html");
    if (!params.AJO_GET_TEMPLATE_URL) return serverError("Missing AJO_GET_TEMPLATE_URL");

    const templateUrl = `${params.AJO_GET_TEMPLATE_URL}/${templateId}`;

    const templateResp = await fetchRaw(templateUrl, {
      method: "GET",
      headers: {
        ...commonHeaders,
        accept: "application/vnd.adobe.ajo.template.v1+json",
      },
    });

    const data = templateResp?.data || null;

    const html = data?.template?.html?.body ?? data?.template?.html ?? null;

    if (!html) {
      return serverError("Template fetched but no template.html found", {
        templateId,
        keys: data ? Object.keys(data) : null,
      });
    }

    const etag = pickEtag(templateResp?.headers || null);

    const stitched = await resolveAndStitchRecursively({ html, params, commonHeaders });
    const aemDebug = await postProcessStitched(stitched.stitchedHtml);

    return ok({
      mode: "templateId",
      templateId,
      html,
      stitchedHtml: stitched.stitchedHtml,
      etag,
      fragmentsResolved: stitched.fragmentsResolvedAll,
      resolutionWarnings: stitched.resolutionWarnings,

      // NEW:
      ...aemDebug,
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