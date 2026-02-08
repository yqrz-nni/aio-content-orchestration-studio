const { ok, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchJson } = require("../../../_lib/fetchJson");
const { requireIms } = require("../../../_lib/ims");

function buildCreateTemplateBody(params, html, editorContext = {}) {
  const name = params.name || "New Template";
  const description = params.description || "";

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
      // If your create endpoint expects { body }, change to: html: { body: html }
      html,
      editorContext: editorContext || {},
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
    if (!params.AJO_GET_TEMPLATE_URL) return serverError("Missing AJO_GET_TEMPLATE_URL");
    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const createFromBaseline =
      params.createFromBaseline === true ||
      params.createFromBaseline === "true" ||
      !params.templateHtml;

    let bodyObj;

    if (createFromBaseline) {
      const baselineId = params.baselineTemplateId || params.AJO_BASELINE_TEMPLATE_ID;
      if (!baselineId) return serverError("Missing AJO_BASELINE_TEMPLATE_ID (or baselineTemplateId).");

      const getUrl = `${params.AJO_GET_TEMPLATE_URL}/${baselineId}`;

      const baseline = await fetchJson(getUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "x-gw-ims-org-id": imsOrg,
          "x-api-key": params.AJO_API_KEY,
          "x-sandbox-name": params.SANDBOX_NAME,
          accept: "application/vnd.adobe.ajo.template.v1+json",
        },
      });

      // Your baseline JSON shows template.html.body
      const baselineHtml =
        baseline?.template?.html?.body ??
        baseline?.template?.html; // fallback if API returns string

      const baselineEditorContext = baseline?.template?.editorContext ?? {};

      bodyObj = buildCreateTemplateBody(params, baselineHtml, baselineEditorContext);
    } else {
      const html =
        typeof params.templateHtml === "string"
          ? params.templateHtml
          : params.templateHtml?.body;

      bodyObj = buildCreateTemplateBody(params, html, params.editorContext || {});
    }

    const payload = await fetchJson(params.AJO_CREATE_TEMPLATE_URL, {
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