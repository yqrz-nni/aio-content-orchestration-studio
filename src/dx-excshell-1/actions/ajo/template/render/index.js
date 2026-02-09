// File: src/dx-excshell-1/actions/ajo/template/render/index.js

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { fetchJson } = require("../../../_lib/fetchJson");
const { requireIms } = require("../../../_lib/ims");

// Only needed if you choose NOT to use a proxy for AEM GraphQL.
let jwtAuth = null;
try {
  jwtAuth = require("@adobe/jwt-auth");
} catch {
  // ok: if you always use proxy, this won't be needed
}

/* ============================================================================
 * Small utilities
 * ============================================================================
 */

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
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/* ============================================================================
 * AJO Fragment resolve + stitch
 * ============================================================================
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
 * Resolve all fragment ids referenced in html (parallelized).
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

  const max = Number(params.maxFragmentsToResolve || 25);
  const toResolve = fragmentIds.slice(0, Math.max(0, max));

  const concurrency = Number(params.ajoFragmentConcurrency || 8);

  const results = await mapLimit(toResolve, concurrency, async (fid) => {
    try {
      return await fetchFragmentById({
        baseUrl: params.AJO_GET_FRAGMENT_URL,
        fragmentIdRaw: fid,
        headers: commonHeaders,
      });
    } catch (e) {
      resolutionWarnings.push(`Failed to resolve fragment ${fid}: ${e.message}`);
      return null;
    }
  });

  fragmentsResolved = results.filter(Boolean);

  if (fragmentIds.length > toResolve.length) {
    resolutionWarnings.push(
      `Resolved ${toResolve.length}/${fragmentIds.length} fragments (capped by maxFragmentsToResolve=${max}).`
    );
  }

  return { fragmentsResolved, resolutionWarnings };
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
 */
async function resolveAndStitchRecursively({ html, params, commonHeaders }) {
  const maxDepth = Number(params.maxFragmentDepth || 3); // you said likely 3

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

/* ============================================================================
 * AEM bindings (AJO handlebars: {{fragment id='aem:<ID>?repoId=...' result='cf'}})
 * ============================================================================
 */

/**
 * Extract AEM fragment bindings from the HTML in-order.
 * IMPORTANT: `index` is the appearance order; we preserve it throughout.
 */
function extractAemBindings(html) {
  if (!html || typeof html !== "string") return [];

  const bindings = [];
  const tagRe = /{{\s*fragment\b([^}]*)}}/gim;

  let m;
  let index = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const inside = m[1] || "";

    const idMatch = inside.match(/\bid\s*=\s*(['"])(aem:[^'"]+)\1/i);
    if (!idMatch) continue;

    const rawId = idMatch[2];
    if (!rawId.toLowerCase().startsWith("aem:")) continue;

    const resultMatch = inside.match(/\bresult\s*=\s*(['"])([^'"]+)\1/i);
    const result = resultMatch ? resultMatch[2] : null;

    let aemId = null;
    let repoId = null;
    try {
      const noPrefix = rawId.slice("aem:".length);
      const [idPart, queryPart] = noPrefix.split("?");
      aemId = (idPart || "").trim() || null;

      if (queryPart) {
        const sp = new URLSearchParams(queryPart);
        repoId = sp.get("repoId") || null;
      }
    } catch {
      // ignore
    }

    // Parse extra args (best effort). We ignore id= and result=.
    const args = {};
    const argRe = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:(['"])(.*?)\2|([^\s}]+))/g;
    let am;
    while ((am = argRe.exec(inside)) !== null) {
      const k = am[1];
      if (!k) continue;
      if (k.toLowerCase() === "id" || k.toLowerCase() === "result") continue;

      const v = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
      args[k] = v;
    }

    bindings.push({
      index,
      result,
      aemId,
      repoId,
      args,
    });
    index++;
  }

  return bindings;
}

/**
 * Build AEM GraphQL endpoint + headers.
 */
async function buildAemGraphqlClient(params) {
  const useProxy = params.USE_AEM_PROXY === "true";

  if (!params.AEM_GQL_PATH) {
    return { ok: false, reason: "Missing AEM_GQL_PATH", gqlUrl: null, headers: null };
  }

  if (!useProxy && !params.AEM_AUTHOR) {
    return { ok: false, reason: "Missing AEM_AUTHOR (and USE_AEM_PROXY is not true)", gqlUrl: null, headers: null };
  }

  if (useProxy && !params.AEM_GQL_PATH_PROXY) {
    return { ok: false, reason: "Missing AEM_GQL_PATH_PROXY (USE_AEM_PROXY=true)", gqlUrl: null, headers: null };
  }

  const gqlUrl = useProxy
    ? params.AEM_GQL_PATH_PROXY
    : new URL(params.AEM_GQL_PATH, params.AEM_AUTHOR).toString();

  const headers = { "content-type": "application/json" };

  if (!useProxy) {
    if (!jwtAuth) return { ok: false, reason: "Missing @adobe/jwt-auth dependency", gqlUrl: null, headers: null };

    if (!params.IMS_HOST) return { ok: false, reason: "Missing IMS_HOST", gqlUrl: null, headers: null };
    if (!params.CLIENT_ID) return { ok: false, reason: "Missing CLIENT_ID", gqlUrl: null, headers: null };
    if (!params.CLIENT_SECRET) return { ok: false, reason: "Missing CLIENT_SECRET", gqlUrl: null, headers: null };
    if (!params.TECH_ACCOUNT_ID) return { ok: false, reason: "Missing TECH_ACCOUNT_ID", gqlUrl: null, headers: null };
    if (!params.ORG_ID) return { ok: false, reason: "Missing ORG_ID", gqlUrl: null, headers: null };
    if (!params.PRIVATE_KEY) return { ok: false, reason: "Missing PRIVATE_KEY", gqlUrl: null, headers: null };
    if (!params.METASCOPES) return { ok: false, reason: "Missing METASCOPES", gqlUrl: null, headers: null };

    const accessTokenResp = await jwtAuth({
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
  }

  return { ok: true, gqlUrl, headers, reason: null };
}

/**
 * Fetch GraphQL JSON and throw (with attached data) if errors[] is present.
 * (AEM GraphQL often returns HTTP 200 with errors[].)
 */
async function postGraphql({ gqlUrl, headers, query, variables, operationName }) {
  const payload = { query };
  if (variables) payload.variables = variables;
  if (operationName) payload.operationName = operationName;

  const data = await fetchJson(gqlUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (data?.errors?.length) {
    const err = new Error("AEM GraphQL returned errors");
    err.status = 502;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Introspect query fields once per invocation to find the correct "ById" field + arg name.
 */
async function introspectQueryFields({ gqlUrl, headers }) {
  const query = `
    query IntrospectQueryFields {
      __type(name: "Query") {
        fields {
          name
          args {
            name
            type { kind name ofType { kind name ofType { kind name } } }
          }
        }
      }
    }
  `;
  const data = await postGraphql({ gqlUrl, headers, query, operationName: "IntrospectQueryFields" });
  return data?.data?.__type?.fields || [];
}

function pickBestByIdField(fields, modelName) {
  const preferredNames = [
    `${modelName}ById`,
    `${modelName}By_id`,
    `${modelName}ByID`,
    `${modelName}ByPath`,
    `${modelName}By_path`,
    `${modelName}BySlug`,
  ];

  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const n of preferredNames) if (byName.has(n)) return byName.get(n);

  const lowerModel = modelName.toLowerCase();
  const candidates = fields.filter((f) => {
    const ln = (f.name || "").toLowerCase();
    return ln.includes(lowerModel) && ln.includes("by");
  });

  return candidates[0] || null;
}

function pickArgNameForByField(field, have) {
  const args = field?.args || [];
  const argNames = args.map((a) => a.name);

  if (have.id) {
    if (argNames.includes("_id")) return "_id";
    if (argNames.includes("id")) return "id";
  }
  if (have.path) {
    if (argNames.includes("_path")) return "_path";
    if (argNames.includes("path")) return "path";
  }
  return argNames[0] || null;
}

function buildByFieldQuery({ fieldName, argName, selectionSet, opName }) {
  return `
    query ${opName}($id: String!) {
      ${fieldName}(${argName}: $id) {
        item {
          ${selectionSet}
        }
      }
    }
  `;
}

/**
 * Your known-good unified selection set (fast-path).
 * Matches the query you confirmed works.
 */
function buildUnifiedSelectionSetKnownGood() {
  return `
    _id
    _path

    primaryImage {
      ... on ImageRef { _path }
    }

    references { referenceNote }

    headlineText
    ctaText
    ctaLink

    ctaImage {
      ... on ImageRef { _path }
    }

    localFootnote
    localReferences { referenceNote }

    eyebrowText
    keyMessageCategory
    triggersBoxedWarning
    imageReferencePlaceholders
    moduleId

    forceBrandStylingLeaveBlankToInheritContextualBrandStyle {
      _path
      _id
      _variation
      color_text_primary
      color_text_secondary
      color_text_tertiary
      color_background_primary
      color_background_secondary
      color_background_tertiary
      color_text_link_primary
      color_text_link_secondary
      color_text_white
      color_text_body
      divider_color
      divider_weight
      component_button_border_radius
      font_size_heading_x1
      font_size_heading_lg
      font_size_heading_med
      font_size_heading_sm
      font_size_heading_xs
      font_family
      email_headline_line_height
      email_body_copy_line_height
      email_banner_content_left_margin
      email_banner_content_right_margin
      email_banner_content_top_margin
      email_banner_content_bottom_margin
      email_banner_content_section_padding
    }
  `;
}

/**
 * Prefetch AEM objects for encountered bindings (parallelized) while preserving order.
 * - prbProperties: fixed selection
 * - unifiedPromotionalContent: known-good selection set (fast-path)
 */
async function prefetchAemBindings({ stitchedHtml, params }) {
  const aemBindingsEncountered = extractAemBindings(stitchedHtml);

  const aemWarnings = [];
  let aemPrefetch = [];
  const aemCacheKeys = [];
  const aemPrefetchData = {};

  if (!aemBindingsEncountered.length) {
    return { aemBindingsEncountered, aemPrefetch, aemCacheKeys, aemWarnings, aemPrefetchData };
  }

  const client = await buildAemGraphqlClient(params);
  if (!client.ok) {
    aemWarnings.push(`AEM prefetch skipped: ${client.reason}`);
    for (const b of aemBindingsEncountered) {
      aemPrefetch.push({ index: b.index, result: b.result, aemId: b.aemId, ok: false, reason: client.reason });
    }
    // ensure stable order
    aemPrefetch.sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
    return { aemBindingsEncountered, aemPrefetch, aemCacheKeys, aemWarnings, aemPrefetchData };
  }

  let queryFields = null;
  try {
    queryFields = await introspectQueryFields({ gqlUrl: client.gqlUrl, headers: client.headers });
  } catch (e) {
    aemWarnings.push(
      `AEM schema introspection failed; falling back to assumed ById field names. Reason: ${e.message}${
        e?.data?.errors ? ` | errors=${safeJsonSnippet(e.data.errors)}` : ""
      }`
    );
    queryFields = null;
  }

  const selectionForPrb = `
    _id
    _path
    name
    prbNumber
    startingDate
    expirationDate
    brandStyle { font_family }
  `;

  function modelFromResult(result) {
    if (result === "prbProperties") return "prbProperties";
    if (result === "cf") return "unifiedPromotionalContent";
    return null;
  }

  // Build tasks in the same order as bindings (for stable cacheKeys + indexing)
  const tasks = aemBindingsEncountered.map((b) => {
    const model = modelFromResult(b.result);
    const cacheKey = model && b.aemId ? `${model}:${b.aemId}` : null;
    if (cacheKey) aemCacheKeys.push(cacheKey);
    return { b, model };
  });

  const concurrency = Number(params.aemConcurrency || 4);

  const results = await mapLimit(tasks, concurrency, async ({ b, model }) => {
    if (!b.aemId) {
      return { kind: "prefetch", row: { index: b.index, result: b.result, aemId: b.aemId, ok: false, reason: "Missing aemId" } };
    }

    if (!model) {
      return {
        kind: "prefetch",
        row: {
          index: b.index,
          result: b.result,
          aemId: b.aemId,
          ok: false,
          reason: `Unknown result '${b.result}' (no model mapping)`,
        },
      };
    }

    // Pick the best query field + arg name (based on introspection if possible)
    let fieldName = null;
    let argName = null;

    if (queryFields) {
      const field = pickBestByIdField(queryFields, model);
      fieldName = field?.name || null;
      argName = field ? pickArgNameForByField(field, { id: true }) : null;
    }

    if (!fieldName) fieldName = `${model}ById`;
    if (!argName) argName = "_id";

    // UNIFIED: known-good selection set
    if (model === "unifiedPromotionalContent") {
      const selectionSet = buildUnifiedSelectionSetKnownGood();
      const opName = `Get_${model}_ById`;
      const query = buildByFieldQuery({ fieldName, argName, selectionSet, opName });

      try {
        const data = await postGraphql({
          gqlUrl: client.gqlUrl,
          headers: client.headers,
          query,
          variables: { id: b.aemId },
          operationName: opName,
        });

        const item = data?.data?.[fieldName]?.item || null;

        const row = { index: b.index, result: b.result, aemId: b.aemId, ok: !!item, fieldName, argName };

        if (item) {
          return { kind: "data", key: `${b.index}:${b.result}`, item, row };
        }

        return {
          kind: "warn",
          warning: `AEM fetch succeeded but returned no item for ${b.result} ${b.aemId} (field=${fieldName}, arg=${argName}).`,
          row,
        };
      } catch (e) {
        const errErrors = e?.data?.errors || null;

        return {
          kind: "warn",
          warning: `Failed to fetch AEM ${b.result} ${b.aemId}: ${e.message}${errErrors ? ` | errors=${safeJsonSnippet(errErrors)}` : ""}`,
          row: { index: b.index, result: b.result, aemId: b.aemId, ok: false, fieldName, argName },
        };
      }
    }

    // PRB: fixed selection
    {
      const selectionSet = selectionForPrb;
      const opName = `Get_${model}_ById`;
      const query = buildByFieldQuery({ fieldName, argName, selectionSet, opName });

      try {
        const data = await postGraphql({
          gqlUrl: client.gqlUrl,
          headers: client.headers,
          query,
          variables: { id: b.aemId },
          operationName: opName,
        });

        const item = data?.data?.[fieldName]?.item || null;

        const row = { index: b.index, result: b.result, aemId: b.aemId, ok: !!item, fieldName, argName };

        if (item) {
          return { kind: "data", key: `${b.index}:${b.result}`, item, row };
        }

        return {
          kind: "warn",
          warning: `AEM fetch succeeded but returned no item for ${b.result} ${b.aemId} (field=${fieldName}, arg=${argName}).`,
          row,
        };
      } catch (e) {
        const errErrors = e?.data?.errors || null;

        return {
          kind: "warn",
          warning: `Failed to fetch AEM ${b.result} ${b.aemId}: ${e.message}${errErrors ? ` | errors=${safeJsonSnippet(errErrors)}` : ""}`,
          row: { index: b.index, result: b.result, aemId: b.aemId, ok: false, fieldName, argName },
        };
      }
    }
  });

  // Fold results into outputs (stable order by binding index)
  for (const r of results) {
    if (!r) continue;
    if (r.kind === "data") {
      aemPrefetchData[r.key] = r.item;
      aemPrefetch.push(r.row);
    } else if (r.kind === "warn") {
      aemWarnings.push(r.warning);
      aemPrefetch.push(r.row);
    } else if (r.kind === "prefetch") {
      aemPrefetch.push(r.row);
    }
  }

  // Maintain appearance order no matter what finished first
  aemPrefetch.sort((x, y) => (x.index ?? 0) - (y.index ?? 0));

  return { aemBindingsEncountered, aemPrefetch, aemCacheKeys, aemWarnings, aemPrefetchData };
}

/* ============================================================================
 * Main
 * ============================================================================
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

    // -------- Mode A: HTML provided directly --------
    if (typeof params.html === "string" && params.html.trim()) {
      const html = params.html;

      const stitched = await resolveAndStitchRecursively({ html, params, commonHeaders });
      const aem = await prefetchAemBindings({ stitchedHtml: stitched.stitchedHtml, params });

      return ok({
        mode: "html",
        templateId,
        html,
        stitchedHtml: stitched.stitchedHtml,
        etag: null,
        fragmentsResolved: stitched.fragmentsResolvedAll,
        resolutionWarnings: stitched.resolutionWarnings,

        aemBindingsEncountered: aem.aemBindingsEncountered,
        aemPrefetch: aem.aemPrefetch,
        aemCacheKeys: aem.aemCacheKeys,
        aemWarnings: aem.aemWarnings,
        aemPrefetchData: aem.aemPrefetchData,
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
    const aem = await prefetchAemBindings({ stitchedHtml: stitched.stitchedHtml, params });

    return ok({
      mode: "templateId",
      templateId,
      html,
      stitchedHtml: stitched.stitchedHtml,
      etag,
      fragmentsResolved: stitched.fragmentsResolvedAll,
      resolutionWarnings: stitched.resolutionWarnings,

      aemBindingsEncountered: aem.aemBindingsEncountered,
      aemPrefetch: aem.aemPrefetch,
      aemCacheKeys: aem.aemCacheKeys,
      aemWarnings: aem.aemWarnings,
      aemPrefetchData: aem.aemPrefetchData,
    });
  } catch (e) {
    return serverError(e?.message || "Unexpected error", { stack: e?.stack });
  }
}

exports.main = main;