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

    return json(200, "AJO DEMO!");
  } catch (error) {
    return json(500, { error: error.message });
  }
}

exports.main = main;