const { ok, badRequest, serverError, corsPreflight } = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");
const { fetchRaw } = require("../../_lib/fetchRaw");

function buildFragmentsUrl(baseUrl, { orderBy = "+name", limit = 1000 } = {}) {
  const u = new URL(baseUrl);
  if (!u.searchParams.get("orderBy")) u.searchParams.set("orderBy", orderBy);
  const currentLimit = u.searchParams.get("limit");
  const rawLimit = currentLimit ?? String(limit);
  const parsedLimit = Number.parseInt(rawLimit, 10);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(parsedLimit, 1000) : 1000;
  u.searchParams.set("limit", String(safeLimit));
  return u.toString();
}

function hasTagId(it, tagId) {
  if (!tagId) return false;
  const tagIds = Array.isArray(it?.tagIds) ? it.tagIds : [];
  return tagIds.some((t) => String(t || "") === String(tagId));
}

function normalizeFragmentId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.toLowerCase().startsWith("ajo:") ? s.slice(4) : s;
}

function buildFragmentGetUrl(baseUrl, fragmentId) {
  const clean = normalizeFragmentId(fragmentId);
  if (!baseUrl || !clean) return null;
  const u = new URL(baseUrl);
  const basePath = String(u.pathname || "").replace(/\/+$/, "");
  u.pathname = `${basePath}/${encodeURIComponent(clean)}`;
  return u.toString();
}

function applyUrlTemplate(template, vars = {}) {
  if (!template) return null;
  const raw = String(template || "").trim();
  if (!raw) return null;
  return raw.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const val = vars[key];
    return val == null ? "" : String(val);
  });
}

function buildVfDeepLink({ prefix, template, baseUrl, id, rawId, name }) {
  const cleanId = normalizeFragmentId(id || rawId);
  if (!cleanId) return null;
  if (prefix) return `${String(prefix).trim()}${encodeURIComponent(cleanId)}`;
  if (template) {
    return applyUrlTemplate(template, {
      id: cleanId,
      rawId: String(rawId || ""),
      name: String(name || ""),
      idEncoded: encodeURIComponent(cleanId),
    });
  }
  if (baseUrl) {
    const u = new URL(String(baseUrl));
    const p = String(u.pathname || "").replace(/\/+$/, "");
    u.pathname = `${p}/${encodeURIComponent(cleanId)}`;
    return u.toString();
  }
  return null;
}

function pickFragmentContent(data) {
  const candidates = [
    data?.fragment?.content,
    data?.fragment?.processedContent,
    data?.fragment?.expression,
    data?.fragment?.content?.expression,
    data?.fragment?.content?.html,
    data?.fragment?.content?.markup,
    data?.fragment?.content?.value,
    data?.fragment?.channels?.email?.content,
    data?.fragment?.channels?.email?.processedContent,
    data?.content,
    data?.processedContent,
    data?.expression,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return null;
}

function detectPrbGlobalUsage(fragmentContent) {
  if (!fragmentContent || typeof fragmentContent !== "string") return false;
  return (
    /\{\{\{?\s*(styles|brandProps|prbProperties)\./i.test(fragmentContent) ||
    /\{\{\{?\s*prb(?:Number|Month|MonthName|Year)\s*\}?\}/i.test(fragmentContent) ||
    /\bprbProperties\./i.test(fragmentContent)
  );
}

function classifyBindingMode(fragmentContent) {
  if (!fragmentContent || typeof fragmentContent !== "string") return null;

  const hasCfSignals =
    /\{\{\{?\s*cf\./i.test(fragmentContent) ||
    /\bresult\s*=\s*(['"])cf\1/i.test(fragmentContent);
  if (hasCfSignals) return "cf";

  if (detectPrbGlobalUsage(fragmentContent)) return "prb-global";

  const hasNestedAjoFragments = /\{\{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:/i.test(fragmentContent);
  if (hasNestedAjoFragments) return "unknown";

  return "none";
}

async function enrichCfBindingCapabilities({ items, params, authHeader, imsOrg }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;
  if (!params.AJO_GET_FRAGMENT_URL) return list.map((it) => ({ ...it, supportsCfBinding: null, bindingMode: null }));

  const concurrency = Number.isFinite(Number(params.vfBindingDetectConcurrency))
    ? Math.max(1, Math.min(12, Number(params.vfBindingDetectConcurrency)))
    : 8;

  const out = list.slice();
  let cursor = 0;

  async function worker() {
    while (cursor < out.length) {
      const idx = cursor++;
      const item = out[idx];
      const url = buildFragmentGetUrl(params.AJO_GET_FRAGMENT_URL, item?.id);
      if (!url) {
        out[idx] = { ...item, supportsCfBinding: null };
        continue;
      }
      try {
        const resp = await fetchRaw(url, {
          method: "GET",
          headers: {
            Authorization: authHeader,
            "x-gw-ims-org-id": imsOrg,
            "x-api-key": params.AJO_API_KEY,
            "x-sandbox-name": params.SANDBOX_NAME,
            accept: "application/vnd.adobe.ajo.fragment.v1.0+json",
          },
        });

        const content = pickFragmentContent(resp?.data || {});
        const bindingMode = classifyBindingMode(content);
        const supportsCfBinding =
          bindingMode === "cf" ? true : bindingMode === "prb-global" || bindingMode === "none" ? false : null;
        out[idx] = { ...item, supportsCfBinding, bindingMode };
      } catch {
        out[idx] = { ...item, supportsCfBinding: null, bindingMode: null };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, out.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const token = params.__ow_headers?.authorization || params.__ow_headers?.Authorization;
    const imsOrg = params.__ow_headers?.["x-gw-ims-org-id"] || params.__ow_headers?.["X-GW-IMS-ORG-ID"];

    if (!token || !imsOrg) {
      return badRequest("Missing Authorization or x-gw-ims-org-id. Forward ims.token and ims.org from the UI.");
    }

    if (!params.AJO_FRAGMENTS_URL) return serverError("Missing AJO_FRAGMENTS_URL");
    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    const url = buildFragmentsUrl(params.AJO_FRAGMENTS_URL, { orderBy: "+name", limit: 1000 });

    const payload = await fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        "x-gw-ims-org-id": imsOrg,
        "x-api-key": params.AJO_API_KEY,
        "x-sandbox-name": params.SANDBOX_NAME,
        accept: "application/vnd.adobe.ajo.fragment-list.v1.0+json",
      },
    });

    if (!params.AJO_VF_CONTENT_BLOCK_TAG_ID) {
      return serverError("Missing AJO_VF_CONTENT_BLOCK_TAG_ID");
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const tagged = items.filter((it) => hasTagId(it, params.AJO_VF_CONTENT_BLOCK_TAG_ID));
    const fallback = items.filter((it) => {
      const type = String(it?.type || "").toLowerCase();
      const channels = Array.isArray(it?.channels) ? it.channels : [];
      return type === "html" && channels.includes("email");
    });
    const filtered = tagged.length ? tagged : fallback;
    const enriched = await enrichCfBindingCapabilities({
      items: filtered,
      params,
      authHeader,
      imsOrg,
    });
    const linked = enriched.map((it) => ({
      ...it,
      deepLinkUrl: buildVfDeepLink({
        prefix: params.AJO_VF_DETAIL_URL_PREFIX,
        template: params.AJO_VF_DEEPLINK_TEMPLATE,
        baseUrl: params.AJO_VF_DEEPLINK_BASE_URL,
        id: it?.id,
        rawId: it?.id,
        name: it?.name,
      }),
    }));
    const bindingDetectionEnabled = Boolean(params.AJO_GET_FRAGMENT_URL);
    const debug = params.debug === true || params.debug === "true";
    const debugFull = params.debug === "full";

    return ok({
      sandbox: params.SANDBOX_NAME,
      totalFetched: items.length,
      totalFiltered: enriched.length,
      usedFallback: tagged.length === 0,
      warning:
        tagged.length === 0
          ? "No vf:content-block labels found; falling back to type=html + channels includes 'email'."
          : undefined,
      bindingDetection: {
        enabled: bindingDetectionEnabled,
        reason: bindingDetectionEnabled ? null : "Missing AJO_GET_FRAGMENT_URL; VF binding capabilities are unknown.",
      },
      autoInsertConfig: {
        compiledReferencesTagId: params.AJO_VF_COMPILED_REFERENCES_TAG_ID || null,
        footerTagId: params.AJO_VF_FOOTER_TAG_ID || null,
        compiledReferencesDefaultVfId: params.AJO_COMPILED_REFERENCES_DEFAULT_VF || null,
      },
      deepLinkConfig: {
        vfDetailUrlPrefix: params.AJO_VF_DETAIL_URL_PREFIX || null,
        vfTemplate: params.AJO_VF_DEEPLINK_TEMPLATE || null,
        vfBaseUrl: params.AJO_VF_DEEPLINK_BASE_URL || null,
      },
      items: linked,
      page: payload?._page,
      debug: debug || debugFull
        ? {
            keysSeen: Array.from(
              new Set(
                items.flatMap((it) =>
                  it && typeof it === "object" ? Object.keys(it) : []
                )
              )
            ).sort(),
            counts: {
              withLabels: items.filter((it) => Array.isArray(it?.labels) && it.labels.length).length,
              withTags: items.filter((it) => Array.isArray(it?.tags) && it.tags.length).length,
              withTagIds: items.filter((it) => Array.isArray(it?.tagIds) && it.tagIds.length).length,
            },
            sample: items.slice(0, 3).map((it) => ({
              id: it?.id,
              name: it?.name,
              labels: it?.labels,
              tagIds: it?.tagIds,
              tags: it?.tags,
              type: it?.type,
              channels: it?.channels,
            })),
            sampleFull: debugFull ? items.slice(0, 3) : undefined,
          }
        : undefined,
      itemsAll: debugFull ? items.slice(0, 200) : undefined,
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
