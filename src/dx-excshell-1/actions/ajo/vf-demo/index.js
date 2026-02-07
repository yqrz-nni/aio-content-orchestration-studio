const {
  ok,
  badRequest,
  serverError,
  badGateway,
  corsPreflight,
} = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");

function pickRandom(items, n) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const token =
      params.__ow_headers?.authorization || params.__ow_headers?.Authorization;

    const imsOrg =
      params.__ow_headers?.["x-gw-ims-org-id"] ||
      params.__ow_headers?.["X-GW-IMS-ORG-ID"];

    if (!token || !imsOrg) {
      return badRequest(
        "Missing Authorization or x-gw-ims-org-id. Forward ims.token and ims.org from the UI."
      );
    }

    if (!params.AJO_FRAGMENTS_URL) {
      return serverError("Missing AJO_FRAGMENTS_URL");
    }
    if (!params.AJO_API_KEY) {
      return serverError("Missing AJO_API_KEY");
    }
    if (!params.SANDBOX_NAME) {
      return serverError("Missing SANDBOX_NAME");
    }

    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const payload = await fetchJson(params.AJO_FRAGMENTS_URL, {
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

    const visual = items.filter((it) => {
      const type = (it?.type || "").toLowerCase();
      const channels = Array.isArray(it?.channels) ? it.channels : [];
      return type === "html" && channels.includes("email");
    });

    const source = visual.length ? visual : items;
    const chosen = pickRandom(source, Math.min(5, source.length)).map((it) => ({
      id: it.id,
      name: it.name,
    }));

    return ok({
      sandbox: params.SANDBOX_NAME,
      totalFetched: items.length,
      totalVisual: visual.length,
      fragments: chosen,
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