const { ok, badRequest, serverError, corsPreflight } = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");

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

function hasLabel(it, label) {
  const labels = Array.isArray(it?.labels) ? it.labels : [];
  return labels.some((l) => String(l || "").toLowerCase() === String(label || "").toLowerCase());
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

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const tagged = items.filter((it) => hasLabel(it, "vf:content-block"));
    const fallback = items.filter((it) => {
      const type = String(it?.type || "").toLowerCase();
      const channels = Array.isArray(it?.channels) ? it.channels : [];
      return type === "html" && channels.includes("email");
    });
    const filtered = tagged.length ? tagged : fallback;
    const debug = params.debug === true || params.debug === "true";
    const debugFull = params.debug === "full";

    return ok({
      sandbox: params.SANDBOX_NAME,
      totalFetched: items.length,
      totalFiltered: filtered.length,
      usedFallback: tagged.length === 0,
      warning:
        tagged.length === 0
          ? "No vf:content-block labels found; falling back to type=html + channels includes 'email'."
          : undefined,
      items: filtered,
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
