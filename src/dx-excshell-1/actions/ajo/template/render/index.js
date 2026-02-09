// File: src/dx-excshell-1/actions/ajo/template/render/index.js

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { requireIms } = require("../../../_lib/ims");

function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function buildGetUrl(params, templateId) {
  const base = params.AJO_GET_TEMPLATE_URL;
  if (!base) return null;
  return `${base}/${templateId}`;
}

function pickEtag(headers = {}) {
  // Depending on fetchRaw implementation, header keys might be normalized
  return headers.etag || headers.ETag || headers["etag"] || headers["ETag"] || null;
}

/**
 * V1 "Render" action:
 * - Today: just fetches the template and returns the HTML body.
 * - Later: this is where we'll call resolve fragments + conditional logic and return fully materialized HTML.
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    // Allow "HTML-first" rendering for the demo.
    // If html is provided, we don't need to fetch from AJO.
    const providedHtml =
      typeof params.html === "string"
        ? params.html
        : typeof params.templateHtml === "string"
          ? params.templateHtml
          : typeof params.templateHtml?.body === "string"
            ? params.templateHtml.body
            : typeof params.html?.body === "string"
              ? params.html.body
              : null;

    // If we're going to fetch from AJO, we need IMS context + AJO config.
    const needsFetch = !providedHtml;

    let token, imsOrg;
    if (needsFetch) {
      const ims = requireIms(params);
      token = ims.token;
      imsOrg = ims.imsOrg;
    }

    const templateId = params.templateId || null;

    if (!providedHtml && !templateId) {
      return badRequest("Missing templateId or html");
    }

    let html = providedHtml;
    let etag = null;

    if (!html) {
      if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
      if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");
      if (!params.AJO_GET_TEMPLATE_URL) return serverError("Missing AJO_GET_TEMPLATE_URL");

      const authHeader = normalizeBearer(token);
      const url = buildGetUrl(params, templateId);
      if (!url) return serverError("Could not build template GET url");

      const resp = await fetchRaw(url, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "x-gw-ims-org-id": imsOrg,
          "x-api-key": params.AJO_API_KEY,
          "x-sandbox-name": params.SANDBOX_NAME,
          accept: "application/vnd.adobe.ajo.template.v1+json",
        },
      });

      const data = resp?.data || null;
      html = data?.template?.html?.body ?? data?.template?.html ?? null;

      if (!html) {
        return serverError("Template fetched but no template.html found", {
          templateId,
          keys: data ? Object.keys(data) : null,
        });
      }

      etag = pickEtag(resp?.headers || null);
    }

    return ok({
      templateId,
      html, // keep for backwards compatibility while we iterate
      renderedHtml: html, // UI should prefer this going forward
      etag,
      // Next: trace, fragmentGraph, variableContext, etc.
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