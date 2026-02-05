const fetch = require("node-fetch");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body,
  };
}

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

    let headers = {
      "Content-Type": "application/json",
    };

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
        "x-api-key": params.AJO_API_KEY,
        Accept: "application/json",
      },
    });

    const text = await r.text();
    if (!r.ok) return json(r.status, { error: text });

    const payload = JSON.parse(text);

    return json(200, "AJO DEMO!");
  } catch (error) {
    return json(500, { error: error.message });
  }
}

exports.main = main;