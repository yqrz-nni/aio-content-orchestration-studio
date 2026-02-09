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

  const max = Number(params.maxFragmentsToResolve || 25);
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
 */
async function resolveAndStitchRecursively({ html, params, commonHeaders }) {
  const maxDepth = Number(params.maxFragmentDepth || 5);

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
 * AEM (AJO handlebars: {{fragment id='aem:<ID>?repoId=...' result='cf'}})
 * ============================================================================
 */

/**
 * Extract AEM fragment bindings from the HTML in-order.
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

function safeJsonSnippet(obj, maxChars = 1200) {
  try {
    const s = JSON.stringify(obj);
    return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
  } catch {
    return String(obj);
  }
}

/* =========================
 * Unified selection helpers
 * ========================= */

function extractUndefinedFieldName(graphQLErrors = []) {
  const msg = graphQLErrors?.[0]?.message || "";
  const m = msg.match(/Field '([^']+)' in type '([^']+)' is undefined/i);
  if (!m) return null;
  return { field: m[1], type: m[2] };
}

function extractUnknownTypeName(graphQLErrors = []) {
  const msg = graphQLErrors?.[0]?.message || "";
  const m = msg.match(/Unknown type '([^']+)'/i);
  if (!m) return null;
  return { type: m[1] };
}

function extractInlineFragmentNotPossible(graphQLErrors = []) {
  const msg = graphQLErrors?.[0]?.message || "";
  // common GraphQL error wording varies; keep broad:
  if (/Fragment cannot be spread here/i.test(msg)) return { message: msg };
  if (/cannot be spread/i.test(msg)) return { message: msg };
  return null;
}

/**
 * Inline fragment builder for primaryImage, trying multiple possible concrete types.
 * Example:
 * primaryImage {
 *   ... on ImageRef { _path }
 *   ... on AssetRef { _path }
 * }
 */
function buildPrimaryImageInlineSelection({ typeNames, fieldList }) {
  const fields = (fieldList || "").trim();
  if (!fields) return "primaryImage { }";

  const types = Array.isArray(typeNames) && typeNames.length ? typeNames : ["ImageRef"];
  const spreads = types.map((t) => `... on ${t} { ${fields} }`).join("\n          ");
  return `primaryImage {\n          ${spreads}\n        }`;
}

/**
 * Build unified selection set from "bodyCopySub" and a "primaryImage block" (string).
 */
function buildUnifiedSelectionSetFromBlocks({ bodyCopySub, primaryImageBlock }) {
  return `
        _id
        _path
        eyebrowText
        headlineText
        bodyCopy { ${bodyCopySub} }
        ${primaryImageBlock}
        ctaText
        ctaLink
        localFootnote
        references { referenceNote }
        localReferences { referenceNote }
  `;
}

/**
 * Introspect a GraphQL type's fields (best-effort; may be blocked).
 */
async function introspectType({ gqlUrl, headers, typeName }) {
  const query = `
    query IntrospectType($name: String!) {
      __type(name: $name) {
        name
        kind
        fields {
          name
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
    }
  `;
  const data = await postGraphql({
    gqlUrl,
    headers,
    query,
    variables: { name: typeName },
    operationName: "IntrospectType",
  });
  return data?.data?.__type || null;
}

/**
 * From an introspected __type, pick "scalar-ish" field names (SCALAR/ENUM).
 */
function pickScalarFieldNames(typeInfo, preferred = []) {
  const fields = typeInfo?.fields || [];
  const scalarish = fields
    .filter((f) => {
      const k = f?.type?.kind;
      const ok = k === "SCALAR" || k === "ENUM";
      const okNested = f?.type?.ofType?.kind === "SCALAR" || f?.type?.ofType?.kind === "ENUM";
      return ok || okNested;
    })
    .map((f) => f.name);

  const out = [];
  for (const p of preferred) if (scalarish.includes(p)) out.push(p);
  for (const n of scalarish) if (!out.includes(n)) out.push(n);
  return out;
}

/**
 * Build a unified selection set:
 * - bodyCopy: subselection (MultiFormatString list)
 * - primaryImage: *inline fragments* for common concrete types, because schemas often use unions/interfaces
 *
 * If introspection is blocked, we still return a safe baseline with ImageRef inline fragment.
 */
async function buildUnifiedSelectionSet({ gqlUrl, headers }) {
  let bodyCopySub = "html plaintext";

  // For primaryImage, we build inline fragments:
  let primaryImageFields = "_path";
  let primaryImageTypeNames = ["ImageRef", "AssetRef", "DAMAssetRef", "Reference", "Image"];

  try {
    const mfs = await introspectType({ gqlUrl, headers, typeName: "MultiFormatString" });
    const mfsFields = pickScalarFieldNames(mfs, ["html", "plaintext", "json", "raw"]);
    if (mfsFields.length) bodyCopySub = mfsFields.slice(0, 3).join(" ");

    // We *can’t* reliably introspect unions to get possibleTypes in all AEM envs,
    // so we keep a curated list of likely types. If your env uses different ones,
    // the retry loop below will still find the right one (or fall back).
  } catch {
    // Introspection might be blocked; fall back to baseline
  }

  const primaryImageBlock = buildPrimaryImageInlineSelection({
    typeNames: primaryImageTypeNames,
    fieldList: primaryImageFields,
  });

  return buildUnifiedSelectionSetFromBlocks({ bodyCopySub, primaryImageBlock });
}

/**
 * Prefetch AEM objects for encountered bindings.
 */
async function prefetchAemBindings({ stitchedHtml, params }) {
  const aemBindingsEncountered = extractAemBindings(stitchedHtml);

  const aemWarnings = [];
  const aemPrefetch = [];
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

  let selectionForUnified = null;

  function modelFromResult(result) {
    if (result === "prbProperties") return "prbProperties";
    if (result === "cf") return "unifiedPromotionalContent";
    return null;
  }

  for (const b of aemBindingsEncountered) {
    const model = modelFromResult(b.result);

    if (!b.aemId) {
      aemPrefetch.push({ index: b.index, result: b.result, aemId: b.aemId, ok: false, reason: "Missing aemId" });
      continue;
    }

    if (!model) {
      aemPrefetch.push({
        index: b.index,
        result: b.result,
        aemId: b.aemId,
        ok: false,
        reason: `Unknown result '${b.result}' (no model mapping)`,
      });
      continue;
    }

    const cacheKey = `${model}:${b.aemId}`;
    aemCacheKeys.push(cacheKey);

    let fieldName = null;
    let argName = null;

    if (queryFields) {
      const field = pickBestByIdField(queryFields, model);
      fieldName = field?.name || null;
      argName = field ? pickArgNameForByField(field, { id: true }) : null;
    }

    if (!fieldName) fieldName = `${model}ById`;
    if (!argName) argName = "_id";

    // UNIFIED: try baseline + a systematic retry across types/fields
    if (model === "unifiedPromotionalContent") {
      if (!selectionForUnified) {
        selectionForUnified = await buildUnifiedSelectionSet({ gqlUrl: client.gqlUrl, headers: client.headers });
      }

      const unifiedBodyCopySubs = ["html plaintext"];
      const primaryImageFieldCandidates = ["_path", "path", "_publishUrl", "_authorUrl", "_id", "id"];

      // likely concrete types; add/remove as needed
      const primaryImageTypeCandidates = ["ImageRef", "AssetRef", "DAMAssetRef", "Image", "Reference"];

      // Candidate 0: whatever buildUnifiedSelectionSet produced
      const candidates = [selectionForUnified];

      // Candidate variants:
      for (const bc of unifiedBodyCopySubs) {
        for (const f of primaryImageFieldCandidates) {
          // 1) plain selection (if primaryImage is actually an object type)
          const plainPrimary = `primaryImage { ${f} }`;
          candidates.push(buildUnifiedSelectionSetFromBlocks({ bodyCopySub: bc, primaryImageBlock: plainPrimary }));

          // 2) inline fragment selection (if union/interface)
          const inlinePrimary = buildPrimaryImageInlineSelection({
            typeNames: primaryImageTypeCandidates,
            fieldList: f,
          });
          candidates.push(buildUnifiedSelectionSetFromBlocks({ bodyCopySub: bc, primaryImageBlock: inlinePrimary }));
        }
      }

      // De-dupe candidates
      const uniqueCandidates = [...new Set(candidates)];

      let lastErr = null;
      let item = null;
      let usedSelection = null;

      for (const selectionSet of uniqueCandidates) {
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

          item = data?.data?.[fieldName]?.item || null;
          usedSelection = selectionSet;
          break; // validated (even if item null)
        } catch (e) {
          lastErr = e;

          // Retry only on schema validation-ish problems
          const errs = e?.data?.errors || [];
          const undef = extractUndefinedFieldName(errs);
          const unkType = extractUnknownTypeName(errs);
          const fragNo = extractInlineFragmentNotPossible(errs);

          if (!undef && !unkType && !fragNo) break;
        }
      }

      if (item) {
        aemPrefetch.push({ index: b.index, result: b.result, aemId: b.aemId, ok: true, fieldName, argName });
        aemPrefetchData[`${b.index}:${b.result}`] = item;
      } else if (!lastErr) {
        aemPrefetch.push({ index: b.index, result: b.result, aemId: b.aemId, ok: false, fieldName, argName });
        aemWarnings.push(
          `AEM fetch succeeded but returned no item for ${b.result} ${b.aemId} (field=${fieldName}, arg=${argName}).`
        );
      } else {
        const errErrors = lastErr?.data?.errors || null;
        aemPrefetch.push({ index: b.index, result: b.result, aemId: b.aemId, ok: false, fieldName, argName });
        aemWarnings.push(
          `Failed to fetch AEM ${b.result} ${b.aemId}: ${lastErr?.message || "Unknown error"}${
            errErrors ? ` | errors=${safeJsonSnippet(errErrors)}` : ""
          }`
        );
        if (usedSelection) {
          aemWarnings.push(`Last unified selection attempted (truncated): ${usedSelection.trim().slice(0, 280)}…`);
        }
      }

      continue;
    }

    // PRB: fixed selection
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

      aemPrefetch.push({
        index: b.index,
        result: b.result,
        aemId: b.aemId,
        ok: !!item,
        fieldName,
        argName,
      });

      if (item) {
        aemPrefetchData[`${b.index}:${b.result}`] = item;
      } else {
        aemWarnings.push(
          `AEM fetch succeeded but returned no item for ${b.result} ${b.aemId} (field=${fieldName}, arg=${argName}).`
        );
      }
    } catch (e) {
      const errErrors = e?.data?.errors || null;

      aemPrefetch.push({
        index: b.index,
        result: b.result,
        aemId: b.aemId,
        ok: false,
        fieldName,
        argName,
      });

      aemWarnings.push(
        `Failed to fetch AEM ${b.result} ${b.aemId}: ${e.message}${errErrors ? ` | errors=${safeJsonSnippet(errErrors)}` : ""}`
      );
    }
  }

  return { aemBindingsEncountered, aemPrefetch, aemCacheKeys, aemWarnings, aemPrefetchData };
}

/**
 * Render action main:
 * - HTML mode: params.html
 * - templateId mode: params.templateId
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