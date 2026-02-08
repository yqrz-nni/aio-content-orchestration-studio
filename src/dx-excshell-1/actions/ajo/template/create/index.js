const { ok, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchJson } = require("../../../_lib/fetchJson");
const { requireIms } = require("../../../_lib/ims");

function buildCreateTemplateBody(params) {
  const name = params.name || "Cyber Monday Sale - Header !!";
  const description = params.description || "Cyber Monday Sale - Header Banner!!";

  const html =
    typeof params.templateHtml === "string"
      ? params.templateHtml
      : params.templateHtml?.body;

  if (!html || typeof html !== "string") {
    const e = new Error("Missing templateHtml (string).");
    e.status = 400;
    throw e;
  }

  return {
    name,
    description,
    templateType: "html",
    channels: ["email"],
    source: { origin: "ajo" },
    template: {
      html,
      editorContext: params.editorContext || {},
    },
  };
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

    const bodyObj = buildCreateTemplateBody(params);

    const payload = await fetchJson(params.AJO_CREATE_TEMPLATE_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "x-gw-ims-org-id": imsOrg,
        "x-api-key": params.AJO_API_KEY,
        "x-sandbox-name": params.SANDBOX_NAME,
        "content-type": "application/json",
        accept: "application/vnd.adobe.ajo.template.v1+json",
      },
      body: JSON.stringify(bodyObj),
    });

    return ok({ message: "Template Creation Successful", result: payload });
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