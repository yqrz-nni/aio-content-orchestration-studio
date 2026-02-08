const { ok, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchJson } = require("../../../_lib/fetchJson");
const { fetchRaw } = require("../../../_lib/fetchRaw");
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

    const authHeader =
      token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const createFromBaseline =
      params.createFromBaseline === true ||
      params.createFromBaseline === "true" ||
      !params.templateHtml;

    let html;
    let editorContext = {};

    if (createFromBaseline) {
      const baselineId =
        params.baselineTemplateId || params.AJO_BASELINE_TEMPLATE_ID;

      const baseline = await fetchJson(
        `${params.AJO_GET_TEMPLATE_URL}/${baselineId}`,
        {
          method: "GET",
          headers: {
            Authorization: authHeader,
            "x-gw-ims-org-id": imsOrg,
            "x-api-key": params.AJO_API_KEY,
            "x-sandbox-name": params.SANDBOX_NAME,
            accept: "application/vnd.adobe.ajo.template.v1+json",
          },
        }
      );

      html =
        baseline?.template?.html?.body ??
        baseline?.template?.html;

      editorContext =
        baseline?.template?.editorContext ?? {};
    } else {
      html =
        typeof params.templateHtml === "string"
          ? params.templateHtml
          : params.templateHtml?.body;

      editorContext = params.editorContext || {};
    }

    const bodyObj = buildCreateTemplateBody(params, html, editorContext);

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

    const location =
      resp.headers["location"] ||
      resp.headers["content-location"];

    const templateId =
      extractTemplateIdFromLocation(location) ||
      resp.data?.id ||
      null;

    return ok({
      message: "Template Creation Successful",
      templateId,
      location,
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