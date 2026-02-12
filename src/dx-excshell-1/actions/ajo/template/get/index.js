const { ok, serverError, corsPreflight, badRequest } = require("../../../_lib/http");
const { fetchJson } = require("../../../_lib/fetchJson");
const { requireIms } = require("../../../_lib/ims");

/**
 * GET AJO template by id
 * Expects:
 * - templateId (string) in params
 * - AJO_GET_TEMPLATE_URL env input (e.g., https://platform.adobe.io/ajo/content/templates)
 * - AJO_API_KEY, SANDBOX_NAME
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const { token, imsOrg } = requireIms(params);

    const templateId = params.templateId;
    if (!templateId) {
      return badRequest("Missing templateId (string).");
    }

    if (!params.AJO_GET_TEMPLATE_URL) return serverError("Missing AJO_GET_TEMPLATE_URL");
    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const url = `${params.AJO_GET_TEMPLATE_URL}/${templateId}`;

    const payload = await fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        "x-gw-ims-org-id": imsOrg,
        "x-api-key": params.AJO_API_KEY,
        "x-sandbox-name": params.SANDBOX_NAME,
        accept: "application/vnd.adobe.ajo.template.v1+json",
      },
    });

    // Convenience fields for the UI
    const htmlBody =
      payload?.template?.html?.body ??
      payload?.template?.html ??
      null;

    const resolvedTemplateId = payload?.id || templateId;
    const templateDetailUrlPrefix = String(params.AJO_TEMPLATE_DETAIL_URL_PREFIX || "").trim();
    const templateDeepLinkUrl =
      templateDetailUrlPrefix && resolvedTemplateId
        ? `${templateDetailUrlPrefix}${encodeURIComponent(String(resolvedTemplateId))}`
        : null;

    return ok({
      templateId: resolvedTemplateId,
      name: payload?.name || null,
      description: payload?.description || null,
      templateType: payload?.templateType || null,
      channels: payload?.channels || null,
      htmlBody,
      deepLinkConfig: {
        templateDetailUrlPrefix: templateDetailUrlPrefix || null,
      },
      templateDeepLinkUrl,
      // Keep the full payload in case you want editorContext etc
      payload,
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
