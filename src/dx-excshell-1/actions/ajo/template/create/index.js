const { ok, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchJson } = require("../../../_lib/fetchJson");
const { fetchRaw } = require("../../../_lib/fetchRaw"); // ✅ add
const { requireIms } = require("../../../_lib/ims");

// ... keep your existing helpers/buildCreateTemplateBody/clone logic ...

function extractTemplateIdFromLocation(location) {
  if (!location || typeof location !== "string") return null;

  // Most likely: https://platform.adobe.io/ajo/content/templates/<id>
  const m =
    location.match(/\/ajo\/content\/templates\/([^/?#]+)/) ||
    location.match(/\/content\/templates\/([^/?#]+)/);

  return m ? m[1] : null;
}

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const { token, imsOrg } = requireIms(params);

    if (!params.AJO_CREATE_TEMPLATE_URL) return serverError("Missing AJO_CREATE_TEMPLATE_URL");
    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const bodyObj = buildCreateTemplateBody(params); // or your baseline clone path

    const resp = await fetchRaw(params.AJO_CREATE_TEMPLATE_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-gw-ims-org-id": imsOrg,
        "x-api-key": params.AJO_API_KEY,
        "x-sandbox-name": params.SANDBOX_NAME,
        "content-type": "application/vnd.adobe.ajo.template.v1+json",
      },
      body: JSON.stringify(bodyObj),
    });

    const location = resp.headers["location"] || resp.headers["content-location"] || null;
    const templateId =
      extractTemplateIdFromLocation(location) ||
      resp.data?.id || // just in case
      null;

    return ok({
      message: "Template Creation Successful",
      templateId,
      location,
      status: resp.status,
      // Keep result for debugging, but avoid dumping huge HTML back unless you want it
      result: resp.data ?? null,
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