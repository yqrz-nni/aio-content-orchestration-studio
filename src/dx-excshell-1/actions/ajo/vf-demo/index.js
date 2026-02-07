const fetch = require("node-fetch");
const { json, badRequest, serverError } = require("../../_lib/http");

function pickRandom(items, n) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main(params) {
  try {
    const token =
      params.__ow_headers?.authorization || params.__ow_headers?.Authorization;

    const imsOrg =
      params.__ow_headers?.["x-gw-ims-org-id"] ||
      params.__ow_headers?.["X-GW-IMS-ORG-ID"];

    if (!token || !imsOrg) {
      return json(400, {
        error:
          "Missing Authorization or x-gw-ims-org-id. Forward ims.token and ims.org from the UI.",
      });
    }
    if (!params.AJO_FRAGMENTS_URL) return json(500, { error: "Missing AJO_FRAGMENTS_URL" });
    if (!params.AJO_API_KEY) return json(500, { error: "Missing AJO_API_KEY" });
    const r = await fetch(params.AJO_FRAGMENTS_URL, {
      method: "GET",
      headers: {
        Authorization: token,
        "x-gw-ims-org-id": imsOrg,
        "x-ims-org-id": imsOrg,
        "x-api-key": params.AJO_API_KEY,
        "x-sandbox-name": params.SANDBOX_NAME,
        accept: "application/vnd.adobe.ajo.fragment-list.v1.0+json",
      },
    });

    const text = await r.text();
    if (!r.ok) return json(r.status, { url: params.AJO_FRAGMENTS_URL, sandbox: params.SANDBOX_NAME, status: r.status, error: text });

    const payload = JSON.parse(text);

    // 1) Pull items out
    const items = Array.isArray(payload?.items) ? payload.items : [];

    // 2) Filter to "visual fragments"
    const visual = items.filter((it) => {
      const type = (it?.type || "").toLowerCase();
      const channels = Array.isArray(it?.channels) ? it.channels : [];
      return type === "html" && channels.includes("email");
    });

    // 3) Pick 5 random (fallback to all items if filter yields none)
    const source = visual.length ? visual : items;
    const chosen = pickRandom(source, Math.min(5, source.length)).map((it) => ({
      id: it.id,
      name: it.name,
    }));

    // 4) Return a clean response payload
    return json(200, {
      sandbox: params.SANDBOX_NAME,
      totalFetched: items.length,
      totalVisual: visual.length,
      fragments: chosen,
      page: payload?._page, // keep for debugging / pagination if you want
    });

  } catch (error) {
    return json(500, { error: error.message });
  }
}

exports.main = main;