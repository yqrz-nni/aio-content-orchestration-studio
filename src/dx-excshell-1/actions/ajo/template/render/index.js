// File: src/dx-excshell-1/actions/ajo/template/render/index.js
//
// Render (preview) action with:
// 1) Optional UI-provided AEM bindingStream (no AEM calls when values provided)
// 2) Optional UI-provided AEM cache (reuse hydrated objects across renders)
// 3) Conditional AEM GraphQL hydration only for missing/insufficient bindings
// 4) Introspection disabled by default (opt-in via params.enableAemIntrospection=true)
// 5) Best-effort renderedHtml: resolves {{cf.*}} and {{prbProperties.*}} by binding order
//
// Notes:
// - This action DOES NOT attempt to “fully execute” AJO handlebars; it focuses on:
//   - AJO fragment resolution/stitching (ajo:* fragments) (recursive)
//   - AEM binding discovery + optional hydration (aem:* fragment calls)
//   - Simple token substitution for namespaces using hydrated binding objects
//
// NEW (Blob mimic):
// - Best-effort evaluation for the common “richtext/bodyCopy liquid blob” used to:
//   - inject inline <p style="..."> using styles context
//   - number references by placeholder tokens (##1, ##2, …) with de-dupe
// - We detect the blob pattern and replace it with computed HTML before stripping leftover {% %}.

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { fetchJson } = require("../../../_lib/fetchJson");
const { requireIms } = require("../../../_lib/ims");

// Optional dependency if you do direct AEM (not proxy)
let jwtAuth = null;
try {
  jwtAuth = require("@adobe/jwt-auth");
} catch {
  // ok
}

/* =============================================================================
 * Utilities
 * ============================================================================= */

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

/* =============================================================================
 * Preview sanitizer + “known blob” evaluator
 * ============================================================================= */

/**
 * Detect + evaluate the common richtext/bodyCopy liquid blob.
 *
 * We intentionally DO NOT attempt to interpret general Liquid/AJO syntax.
 * We only detect the well-known pattern and replace it with computed HTML.
 */
function looksLikeRichTextBodyCopyBlob(s) {
  if (!s || typeof s !== "string") return false;
  // Heuristics: the blob typically has "mirrorUrl", "refWrapper", "bodyCopy", and triple-stash output.
  const hasMirror = s.includes("let mirrorUrl");
  const hasRefWrapper = s.includes("refWrapper");
  const hasBodyCopy = s.includes("bodyCopy");
  const hasTriple = s.includes("{{{bodyCopy}}}") || s.includes("{{{ bodyCopy }}}");
  return !!(hasMirror && hasRefWrapper && hasBodyCopy && hasTriple);
}

function buildInlinePStyleTag(stylesCtx) {
  const s = stylesCtx && typeof stylesCtx === "object" ? stylesCtx : null;

  // Keep behavior close to your blob (string concat). If fields are missing, we just omit values.
  const fontSize = s?.font_size_heading_med ?? "";
  const color = s?.color_text_body ?? "";
  const family = s?.font_family ?? "";
  const lineHeight = s?.email_body_copy_line_height ?? "";

  // Your blob used <p style='...'> (single quotes). Keep it.
  return (
    "<p style='" +
    "font-size:" +
    fontSize +
    ";" +
    "color:" +
    color +
    ";" +
    "font-family:" +
    family +
    ";" +
    "line-height:" +
    lineHeight +
    ";" +
    "'>"
  );
}

/**
 * Mimic the blob’s intent:
 * - Replace the first "<p>" with "<p style='...'>"
 * - Replace "##N" placeholders with de-duped reference indices based on cf.references[].referenceNote
 *
 * Notes:
 * - This is best-effort. If cf/bodyCopy/references are missing, returns "".
 * - The blob loops bodyCopy array and concatenates results.
 */
function renderBodyCopyLikeAjo({ cfCtx, stylesCtx, refWrapper = "##", refSplit = "~~" }) {
  const cf = cfCtx && typeof cfCtx === "object" ? cfCtx : null;
  if (!cf) return "";

  const bodyCopies = Array.isArray(cf?.bodyCopy) ? cf.bodyCopy : [];
  if (!bodyCopies.length) return "";

  const references = Array.isArray(cf?.references) ? cf.references : [];

  const cssBuilder = buildInlinePStyleTag(stylesCtx);

  let refCount = 0;
  let allReferences = ""; // "note~~note~~..."
  const getRefArray = () => (allReferences ? allReferences.split(refSplit).filter(Boolean) : []);

  const outParts = [];

  for (const bodyCopyRaw of bodyCopies) {
    let bodyCopy = String(bodyCopyRaw ?? "");
    // Blob behavior: replace the first literal "<p>" with computed styled <p ...>
    bodyCopy = bodyCopy.replace("<p>", cssBuilder);

    // Replace placeholders by scanning references in order (localRefCount)
    let localRefCount = 0;
    for (const ref of references) {
      localRefCount += 1;
      const placeholderTarget = `${refWrapper}${localRefCount}`;

      const refNote = ref?.referenceNote ?? "";
      if (!refNote) continue;

      const refArray = getRefArray();
      const existingIndex = refArray.indexOf(refNote);

      if (existingIndex >= 0) {
        // already exists — use its index+1
        bodyCopy = bodyCopy.split(placeholderTarget).join(String(existingIndex + 1));
      } else {
        // new — increment global refCount and append
        refCount += 1;
        bodyCopy = bodyCopy.split(placeholderTarget).join(String(refCount));
        allReferences = allReferences + refNote + refSplit;
      }
    }

    outParts.push(bodyCopy);
  }

  return outParts.join("");
}

/**
 * Replace any detected richtext/bodyCopy liquid blob inside a segment.
 * We keep this scoped to segments to preserve binding-order context.
 */
function replaceRichTextBlobsInSegment(segment, { cfCtx, stylesCtx }) {
  if (!segment || typeof segment !== "string") return segment;
  if (!looksLikeRichTextBodyCopyBlob(segment)) return segment;

  // We replace the *entire blob block* with computed HTML.
  // Best-effort regex:
  // - start: "{% let mirrorUrl" (possibly whitespace)
  // - end: "{{{bodyCopy}}}" (allow spaces) and optional trailing whitespace
  //
  // If your blob has more after triple stash, this leaves that behind; but
  // stripAjoSyntax() will remove remaining {% %} tags anyway.
  const blobRe = /{%\s*let\s+mirrorUrl[\s\S]*?\{\{\{\s*bodyCopy\s*\}\}\}/gim;

  return segment.replace(blobRe, () => {
    return renderBodyCopyLikeAjo({ cfCtx, stylesCtx });
  });
}

/**
 * Evaluate known liquid blobs using binding order context.
 * We scan stitchedHtml in the order of AEM bindings so we can know “current cf/styles”
 * at each region of the template.
 */
function evaluateKnownLiquidByBindings({ stitchedHtml, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
  if (!stitchedHtml) return stitchedHtml;

  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : [])
    .filter((b) => b?.result === "prbProperties" || b?.result === "cf")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  if (!binds.length) {
    // No binding context; still attempt global replace (rare, but harmless)
    return replaceRichTextBlobsInSegment(stitchedHtml, { cfCtx: null, stylesCtx: null });
  }

  let cursor = 0;
  let out = "";

  let currentPrb = null;
  let currentCf = null;
  let currentStyles = null;

  for (const b of binds) {
    const tag = b.rawTag;
    const tagPos = stitchedHtml.indexOf(tag, cursor);
    if (tagPos < 0) continue;

    const before = stitchedHtml.slice(cursor, tagPos);
    out += replaceRichTextBlobsInSegment(before, { cfCtx: currentCf, stylesCtx: currentStyles });

    // Keep the binding tag for later passes (they strip it)
    out += tag;

    cursor = tagPos + tag.length;

    const streamKey = `${b.index}:${b.result}`;
    const ctx = aemPrefetchDataByStreamKey?.[streamKey] ?? null;

    if (b.result === "prbProperties") currentPrb = ctx;
    if (b.result === "cf") currentCf = ctx;

    currentStyles = deriveStylesContext({ prbCtx: currentPrb, cfCtx: currentCf });
  }

  out += replaceRichTextBlobsInSegment(stitchedHtml.slice(cursor), { cfCtx: currentCf, stylesCtx: currentStyles });
  return out;
}

/**
 * Preview sanitizer:
 * Remove AJO/Handlebars syntax from rendered preview HTML only.
 * (Canonical AJO HTML remains untouched; this is for iframe preview output.)
 */
function stripAjoSyntax(html) {
  if (!html || typeof html !== "string") return html;

  let out = html;

  // 1) Remove ACR wrapped blocks:
  // {{!-- [acr-start ... }}   ...anything...   {{!-- ... [acr-end ... }}
  // - non-greedy, across newlines
  // - keeps everything else (including {{cf.*}} tokens)
  const acrBlockRe =
    /{{!--\s*\[acr-start[\s\S]*?}}[\s\S]*?{{!--[\s\S]*?\[acr-end[\s\S]*?}}/gim;

  out = out.replace(acrBlockRe, "");

  // 2) Remove Liquid tags: {% ... %}
  const liquidTagRe = /{%\s*[\s\S]*?\s*%}/g;
  out = out.replace(liquidTagRe, "");

  return out;
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

/* =============================================================================
 * AJO Fragment resolve + stitch (ajo:* fragments)
 * ============================================================================= */

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

    const re = new RegExp(`{{\\s*fragment\\b[^}]*\\bid\\s*=\\s*(['"])${escapeRegExp(rawId)}\\1[^}]*}}`, "gi");

    out = out.replace(re, replacement);
  }

  return out;
}

/**
 * Resolve + stitch recursively up to a max depth (handles nested fragments).
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

    for (const f of fragmentsResolved) {
      if (f && f.id && !byId.has(f.id)) byId.set(f.id, f);
    }

    const nextHtml = stitchFragmentsIntoHtml(currentHtml, fragmentsResolved);
    if (nextHtml === currentHtml) break;

    currentHtml = nextHtml;
  }

  return {
    stitchedHtml: currentHtml,
    fragmentsResolvedAll: [...byId.values()],
    resolutionWarnings: allWarnings,
  };
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
 * - Removes invalid/non-existent fields (e.g. `indication`)
 * - Adds required identity fields for brands + brandStyle
 * - Keeps ImageRef fragment for icon
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
 * Best-effort token replacement for namespaces, by binding order
 * ============================================================================= */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getByPath(obj, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Coercion rules to make preview feel closer to AJO:
 * - If a value is an object with `_path` string => return that
 * - If `_path` is nested like `{ _path: { _path: "..." } }` => return inner
 * - If `{ html: "..." }` or `{ plaintext: "..." }` => return those
 * - Else JSON.stringify(object)
 */
function coerceValue(val) {
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);

  if (typeof val === "object") {
    // common AEM ref patterns
    if (typeof val._path === "string") return val._path;
    if (val._path && typeof val._path === "object" && typeof val._path._path === "string") return val._path._path;

    if (typeof val.html === "string") return val.html;
    if (typeof val.plaintext === "string") return val.plaintext;

    try {
      return JSON.stringify(val);
    } catch {
      return "";
    }
  }

  return "";
}

function replaceNamespaceVars(segment, namespace, ctx) {
  if (!segment || !ctx) return segment;

  const triple = new RegExp(`\\{\\{\\{\\s*${namespace}\\.([a-zA-Z0-9_$.]+)\\s*\\}\\}\\}`, "g");
  const dbl = new RegExp(`\\{\\{\\s*${namespace}\\.([a-zA-Z0-9_$.]+)\\s*\\}\\}`, "g");

  let out = segment.replace(triple, (_m, path) => {
    const v = coerceValue(getByPath(ctx, path));
    return v; // raw
  });

  out = out.replace(dbl, (_m, path) => {
    const v = coerceValue(getByPath(ctx, path));
    return escapeHtml(v);
  });

  return out;
}

function renderNamespaceByBindingOrder({ html, namespace, bindings, dataByStreamKey }) {
  if (!html) return html;

  const binds = (Array.isArray(bindings) ? bindings : [])
    .filter((b) => b?.result === namespace && typeof b?.rawTag === "string")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  if (!binds.length) return html;

  let cursor = 0;
  let out = "";
  let currentCtx = null;

  for (const b of binds) {
    const tag = b.rawTag;
    const tagPos = html.indexOf(tag, cursor);
    if (tagPos < 0) continue;

    const before = html.slice(cursor, tagPos);
    out += replaceNamespaceVars(before, namespace, currentCtx);

    // ✅ strip binding tag from preview output (we only needed it for ordering)
    out += "";

    cursor = tagPos + tag.length;

    const skey = `${b.index}:${b.result}`;
    currentCtx = dataByStreamKey?.[skey] ?? null;
  }

  out += replaceNamespaceVars(html.slice(cursor), namespace, currentCtx);
  return out;
}

/**
 * Styles context derivation:
 * - Default to PRB brandStyle when present
 * - Allow CF override via forceBrandStylingLeaveBlankToInheritContextualBrandStyle object
 */
function deriveStylesContext({ prbCtx, cfCtx }) {
  const prbStyle = prbCtx?.brandStyle && typeof prbCtx.brandStyle === "object" ? prbCtx.brandStyle : null;

  const cfOverride =
    cfCtx?.forceBrandStylingLeaveBlankToInheritContextualBrandStyle &&
    typeof cfCtx.forceBrandStylingLeaveBlankToInheritContextualBrandStyle === "object"
      ? cfCtx.forceBrandStylingLeaveBlankToInheritContextualBrandStyle
      : null;

  return cfOverride || prbStyle || null;
}

/**
 * Replace {{styles.*}} by binding order, but "styles context" is derived from the
 * most recent PRB + CF binding objects encountered as we scan the html.
 */
function resolveStylesByBindings({ stitchedHtml, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
  if (!stitchedHtml) return stitchedHtml;

  const binds = (Array.isArray(aemBindingsEncountered) ? aemBindingsEncountered : [])
    .filter((b) => b?.result === "prbProperties" || b?.result === "cf")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));

  let cursor = 0;
  let out = "";

  let currentPrb = null;
  let currentCf = null;
  let currentStyles = null;

  for (const b of binds) {
    const tag = b.rawTag;
    const tagPos = stitchedHtml.indexOf(tag, cursor);
    if (tagPos < 0) continue;

    out += replaceNamespaceVars(stitchedHtml.slice(cursor, tagPos), "styles", currentStyles);

    // ✅ strip binding tag from preview output
    out += "";

    cursor = tagPos + tag.length;

    const streamKey = `${b.index}:${b.result}`;
    const ctx = aemPrefetchDataByStreamKey?.[streamKey] ?? null;

    if (b.result === "prbProperties") currentPrb = ctx;
    if (b.result === "cf") currentCf = ctx;

    currentStyles = deriveStylesContext({ prbCtx: currentPrb, cfCtx: currentCf });
  }

  out += replaceNamespaceVars(stitchedHtml.slice(cursor), "styles", currentStyles);
  return out;
}

function buildRenderedHtmlBestEffort({ stitchedHtml, aemBindingsEncountered, aemPrefetchDataByStreamKey }) {
  let out = stitchedHtml;

  // ✅ First, mimic known AJO blob behavior (richtext/bodyCopy) using binding-order context.
  out = evaluateKnownLiquidByBindings({
    stitchedHtml: out,
    aemBindingsEncountered,
    aemPrefetchDataByStreamKey,
  });

  // styles first (it is derived from PRB/CF binding order)
  out = resolveStylesByBindings({
    stitchedHtml: out,
    aemBindingsEncountered,
    aemPrefetchDataByStreamKey,
  });

  // then normal namespaces
  out = renderNamespaceByBindingOrder({
    html: out,
    namespace: "prbProperties",
    bindings: aemBindingsEncountered,
    dataByStreamKey: aemPrefetchDataByStreamKey,
  });

  out = renderNamespaceByBindingOrder({
    html: out,
    namespace: "cf",
    bindings: aemBindingsEncountered,
    dataByStreamKey: aemPrefetchDataByStreamKey,
  });

  // ✅ final sanitize for preview HTML (removes leftover {% %} + ACR blocks)
  return stripAjoSyntax(out);
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

/* =============================================================================
 * Main
 * ============================================================================= */

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
      const aem = await resolveAemBindingValues({ stitchedHtml: stitched.stitchedHtml, params });

      const renderedHtml = buildRenderedHtmlBestEffort({
        stitchedHtml: stitched.stitchedHtml,
        aemBindingsEncountered: aem.aemBindingsEncountered,
        aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,
      });

      return ok({
        mode: "html",
        templateId,
        html,
        stitchedHtml: stitched.stitchedHtml,
        renderedHtml,
        etag: null,

        fragmentsResolved: stitched.fragmentsResolvedAll,
        resolutionWarnings: stitched.resolutionWarnings,

        aemBindingsEncountered: aem.aemBindingsEncountered,
        aemPrefetch: aem.aemPrefetch,
        aemCacheKeys: aem.aemCacheKeys,
        aemWarnings: aem.aemWarnings,
        aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,

        perf: {
          streamHits: aem.streamHits,
          cacheHits: aem.cacheHits,
          hydratedCount: aem.hydratedCount,
          totalBindings: aem.aemBindingsEncountered?.length || 0,
        },
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
    const aem = await resolveAemBindingValues({ stitchedHtml: stitched.stitchedHtml, params });

    const renderedHtml = buildRenderedHtmlBestEffort({
      stitchedHtml: stitched.stitchedHtml,
      aemBindingsEncountered: aem.aemBindingsEncountered,
      aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,
    });

    return ok({
      mode: "templateId",
      templateId,
      html,
      stitchedHtml: stitched.stitchedHtml,
      renderedHtml,
      etag,

      fragmentsResolved: stitched.fragmentsResolvedAll,
      resolutionWarnings: stitched.resolutionWarnings,

      aemBindingsEncountered: aem.aemBindingsEncountered,
      aemPrefetch: aem.aemPrefetch,
      aemCacheKeys: aem.aemCacheKeys,
      aemWarnings: aem.aemWarnings,
      aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,

      perf: {
        streamHits: aem.streamHits,
        cacheHits: aem.cacheHits,
        hydratedCount: aem.hydratedCount,
        totalBindings: aem.aemBindingsEncountered?.length || 0,
      },
    });
  } catch (e) {
    return serverError(e?.message || "Unexpected error", { stack: e?.stack });
  }
}

exports.main = main;