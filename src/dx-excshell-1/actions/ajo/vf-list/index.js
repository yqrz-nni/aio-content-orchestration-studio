const { ok, badRequest, serverError, corsPreflight } = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");

function buildFragmentsUrl(baseUrl, { orderBy = "+name", limit = 1000 } = {}) {
  const u = new URL(baseUrl);
  if (!u.searchParams.get("orderBy")) u.searchParams.set("orderBy", orderBy);
  if (!u.searchParams.get("limit")) u.searchParams.set("limit", String(limit));
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
    const filtered = items.filter((it) => hasLabel(it, "vf:content-block"));

    return ok({
      sandbox: params.SANDBOX_NAME,
      totalFetched: items.length,
      totalFiltered: filtered.length,
      items: filtered,
      page: payload?._page,
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
