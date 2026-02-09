// File: src/dx-excshell-1/actions/ajo/template/render/aemBindings.js

const { fetchJson } = require("../../../_lib/fetchJson");
const { safeJsonSnippet, mapLimit } = require("./utils");

// Optional dependency if you do direct AEM (not proxy)
let jwtAuth = null;
try {
  jwtAuth = require("@adobe/jwt-auth");
} catch {
  // ok
}

/* =============================================================================
 * AEM bindings (AJO handlebars: {{fragment id='aem:<ID>?repoId=...' result='cf'}})
 * ============================================================================= */

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
      rawTag: m[0],
    });
    index++;
  }

  return bindings;
}

function normalizeRenderContext(params) {
  const rc = params?.renderContext && typeof params.renderContext === "object" ? params.renderContext : {};
  const bindingStream = Array.isArray(rc.bindingStream) ? rc.bindingStream : null;
  const cache = rc.cache && typeof rc.cache === "object" ? rc.cache : null;
  return { renderContext: rc, bindingStream, cache };
}

function streamKeyForBinding(binding) {
  const idx = Number(binding?.index);
  const r = binding?.result || "";
  return `${idx}:${r}`;
}

function cacheKeyForModel(model, aemId) {
  if (!model || !aemId) return null;
  return `${model}:${aemId}`;
}

function modelFromResult(result) {
  if (result === "prbProperties") return "prbProperties";
  if (result === "cf") return "unifiedPromotionalContent";
  return null;
}

/**
 * Sufficient checks to avoid “PRB arrived but missing brandStyle/brands”
 */
function isSufficientBindingValue(model, value) {
  if (!value || typeof value !== "object") return false;
  if (!value._id) return false;

  if (model === "prbProperties") {
    if (!value.brandStyle || typeof value.brandStyle !== "object") return false;
    if (!Array.isArray(value.brands)) return false;
    return true;
  }

  if (model === "unifiedPromotionalContent") {
    if (!value.headlineText && !value.eyebrowText && !value.primaryImage) return false;
    return true;
  }

  return true;
}

/* =============================================================================
 * Build AEM GraphQL endpoint + headers.
 * ============================================================================= */

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

  const gqlUrl = useProxy ? params.AEM_GQL_PATH_PROXY : new URL(params.AEM_GQL_PATH, params.AEM_AUTHOR).toString();
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
 * Introspection (OPTIONAL, disabled by default).
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

  const byName = new Map((fields || []).map((f) => [f.name, f]));
  for (const n of preferredNames) if (byName.has(n)) return byName.get(n);

  const lowerModel = modelName.toLowerCase();
  const candidates = (fields || []).filter((f) => {
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
 * Unified promo selection set (known-good).
 * Only ImageRef needs `... on ImageRef`.
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
 * PRB selection set (corrected to match known-good PRB query/response):
 */
function buildPrbSelectionSet() {
  return `
    _id
    _path
    prbNumber
    name
    expirationDate
    startingDate

    brands {
      _path
      _id
      _variation
      name
      displayName
      homepageUrl
      piLink
      isiLink
      icon {
        ... on ImageRef { _path }
      }
    }

    brandStyle {
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
      ajoTemplateId
    }
  `;
}

/* =============================================================================
 * Core: Resolve AEM binding values (stream/cache/hydrate)
 * ============================================================================= */

async function resolveAemBindingValues({ stitchedHtml, params }) {
  const aemBindingsEncountered = extractAemBindings(stitchedHtml);
  const aemWarnings = [];

  const { bindingStream, cache } = normalizeRenderContext(params);

  const aemPrefetch = [];
  const aemCacheKeys = [];
  const aemPrefetchDataByStreamKey = {}; // `${index}:${result}` -> object

  let streamHits = 0;
  let cacheHits = 0;
  let hydratedCount = 0;

  if (!aemBindingsEncountered.length) {
    return {
      aemBindingsEncountered,
      aemPrefetch,
      aemCacheKeys,
      aemWarnings,
      aemPrefetchDataByStreamKey,
      streamHits,
      cacheHits,
      hydratedCount,
    };
  }

  // Map stream by `${index}:${result}`.
  const streamMap = new Map();
  if (Array.isArray(bindingStream)) {
    for (const entry of bindingStream) {
      const idx = Number(entry?.index);
      const res = entry?.result || null;
      if (!Number.isFinite(idx) || !res) continue;
      streamMap.set(`${idx}:${res}`, entry);
    }
  }

  const misses = [];

  for (const b of aemBindingsEncountered) {
    const skey = streamKeyForBinding(b);
    const model = modelFromResult(b.result);
    const ck = cacheKeyForModel(model, b.aemId);
    if (ck) aemCacheKeys.push(ck);

    // 1) Stream hit (ONLY if sufficient)
    const streamEntry = streamMap.get(skey);
    if (streamEntry && streamEntry.value && typeof streamEntry.value === "object") {
      if (model && isSufficientBindingValue(model, streamEntry.value)) {
        streamHits++;
        aemPrefetchDataByStreamKey[skey] = streamEntry.value;

        aemPrefetch.push({
          index: b.index,
          result: b.result,
          aemId: b.aemId,
          ok: true,
          source: "bindingStream",
          model,
        });
        continue;
      }

      aemPrefetch.push({
        index: b.index,
        result: b.result,
        aemId: b.aemId,
        ok: false,
        source: "bindingStreamInsufficient",
        model,
        reason: "bindingStream value missing required fields; will hydrate",
      });

      if (model && b.aemId) misses.push({ binding: b, model, skey });
      continue;
    }

    // 2) Cache hit (ONLY if sufficient)
    if (cache && ck && cache[ck] && typeof cache[ck] === "object") {
      if (model && isSufficientBindingValue(model, cache[ck])) {
        cacheHits++;
        aemPrefetchDataByStreamKey[skey] = cache[ck];

        aemPrefetch.push({
          index: b.index,
          result: b.result,
          aemId: b.aemId,
          ok: true,
          source: "cache",
          model,
        });
        continue;
      }

      aemPrefetch.push({
        index: b.index,
        result: b.result,
        aemId: b.aemId,
        ok: false,
        source: "cacheInsufficient",
        model,
        reason: "cache value missing required fields; will hydrate",
      });

      if (model && b.aemId) misses.push({ binding: b, model, skey });
      continue;
    }

    // 3) Miss (maybe hydrate)
    aemPrefetch.push({
      index: b.index,
      result: b.result,
      aemId: b.aemId,
      ok: false,
      source: "miss",
      model,
      reason: !model ? `Unknown result '${b.result}' (no model mapping)` : "Not provided (stream/cache miss)",
    });

    if (model && b.aemId) misses.push({ binding: b, model, skey });
  }

  const allowHydrate =
    params.allowAemHydrate === undefined ? true : params.allowAemHydrate === true || params.allowAemHydrate === "true";

  if (!misses.length || !allowHydrate) {
    if (!allowHydrate && misses.length) {
      aemWarnings.push(`AEM hydration skipped by allowAemHydrate=false; ${misses.length} bindings remain unresolved.`);
    }
    aemPrefetch.sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
    return {
      aemBindingsEncountered,
      aemPrefetch,
      aemCacheKeys,
      aemWarnings,
      aemPrefetchDataByStreamKey,
      streamHits,
      cacheHits,
      hydratedCount,
    };
  }

  const client = await buildAemGraphqlClient(params);
  if (!client.ok) {
    aemWarnings.push(`AEM hydration skipped: ${client.reason}`);
    aemPrefetch.sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
    return {
      aemBindingsEncountered,
      aemPrefetch,
      aemCacheKeys,
      aemWarnings,
      aemPrefetchDataByStreamKey,
      streamHits,
      cacheHits,
      hydratedCount,
    };
  }

  const enableIntrospection = params.enableAemIntrospection === true || params.enableAemIntrospection === "true";
  let queryFields = null;

  if (enableIntrospection) {
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
  }

  const selectionForPrb = buildPrbSelectionSet();
  const selectionUnified = buildUnifiedSelectionSetKnownGood();
  const concurrency = Number(params.aemConcurrency || 4);

  const results = await mapLimit(misses, concurrency, async ({ binding, model, skey }) => {
    let fieldName = null;
    let argName = null;

    if (queryFields) {
      const field = pickBestByIdField(queryFields, model);
      fieldName = field?.name || null;
      argName = field ? pickArgNameForByField(field, { id: true }) : null;
    }

    if (!fieldName) fieldName = `${model}ById`;
    if (!argName) argName = "_id";

    const selectionSet = model === "unifiedPromotionalContent" ? selectionUnified : selectionForPrb;
    const opName = `Get_${model}_ById`;
    const query = buildByFieldQuery({ fieldName, argName, selectionSet, opName });

    try {
      const data = await postGraphql({
        gqlUrl: client.gqlUrl,
        headers: client.headers,
        query,
        variables: { id: binding.aemId },
        operationName: opName,
      });

      const item = data?.data?.[fieldName]?.item || null;
      if (!item) {
        return {
          ok: false,
          skey,
          model,
          binding,
          fieldName,
          argName,
          warning: `AEM fetch returned no item for ${binding.result} ${binding.aemId} (field=${fieldName}, arg=${argName}).`,
        };
      }

      return { ok: true, skey, model, binding, item, fieldName, argName };
    } catch (e) {
      const errErrors = e?.data?.errors || null;
      return {
        ok: false,
        skey,
        model,
        binding,
        fieldName,
        argName,
        warning: `Failed to fetch AEM ${binding.result} ${binding.aemId}: ${e.message}${
          errErrors ? ` | errors=${safeJsonSnippet(errErrors)}` : ""
        }`,
      };
    }
  });

  const byRowKey = new Map(aemPrefetch.map((r) => [`${r.index}:${r.result}`, r]));

  for (const r of results) {
    if (!r) continue;
    if (r.ok) {
      hydratedCount++;
      aemPrefetchDataByStreamKey[r.skey] = r.item;

      const row = byRowKey.get(r.skey);
      if (row) {
        row.ok = true;
        row.source = "aemHydrate";
        row.model = r.model;
        row.fieldName = r.fieldName;
        row.argName = r.argName;
        delete row.reason;
      }
    } else {
      if (r.warning) aemWarnings.push(r.warning);
      const row = byRowKey.get(r.skey);
      if (row) {
        row.ok = false;
        row.source = "aemHydrateFailed";
        row.model = r.model;
        row.fieldName = r.fieldName;
        row.argName = r.argName;
        row.reason = row.reason || "Hydration failed";
      }
    }
  }

  aemPrefetch.sort((x, y) => (x.index ?? 0) - (y.index ?? 0));

  return {
    aemBindingsEncountered,
    aemPrefetch,
    aemCacheKeys,
    aemWarnings,
    aemPrefetchDataByStreamKey,
    streamHits,
    cacheHits,
    hydratedCount,
  };
}

module.exports = {
  extractAemBindings,
  resolveAemBindingValues,
};