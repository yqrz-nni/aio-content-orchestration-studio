// File: src/dx-excshell-1/actions/ajo/template/update/index.js

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchJson } = require("../../../_lib/fetchJson");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { requireIms } = require("../../../_lib/ims");

function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function buildUpdateUrl(params, templateId) {
  // Prefer a dedicated update URL if you add one later,
  // otherwise reuse GET base (the pattern you shared).
  const base = params.AJO_UPDATE_TEMPLATE_URL || params.AJO_GET_TEMPLATE_URL;
  if (!base) return null;
  return `${base}/${templateId}`;
}

function coerceHtml(params) {
  if (typeof params.html === "string") return params.html;
  if (typeof params.templateHtml === "string") return params.templateHtml;
  if (typeof params.templateHtml?.body === "string") return params.templateHtml.body;
  if (typeof params.html?.body === "string") return params.html.body;
  return null;
}

function pickEtag(headers = {}) {
  // Depending on fetchRaw implementation, header keys might be normalized
  return headers.etag || headers.ETag || headers["etag"] || headers["ETag"] || null;
}

function buildUpdateBody({ existing, params, html, editorContext }) {
  // Keep AJO shape consistent with create payload.
  // We prefer the incoming fields, but fall back to existing.
  const name = params.name ?? existing?.name;
  const description = params.description ?? existing?.description ?? "";

  // labels:
  // - if caller sends labels explicitly, use them
  // - else keep existing labels
  const labels = Array.isArray(params.labels)
    ? params.labels
    : Array.isArray(existing?.labels)
      ? existing.labels
      : [];

  // templateType / channels / source:
  const templateType = existing?.templateType ?? "html";
  const channels = existing?.channels ?? ["email"];
  const source = existing?.source ?? { origin: "ajo" };

  if (!name) {
    const e = new Error("Missing name (and could not infer from existing template).");
    e.status = 400;
    throw e;
  }
  if (!html || typeof html !== "string") {
    const e = new Error("Missing html/templateHtml (string) (and could not infer from existing template).");
    e.status = 400;
    throw e;
  }

  return {
    name,
    description,
    templateType,
    channels,
    source,
    labels,
    template: {
      html,
      editorContext: editorContext || existing?.template?.editorContext || {},
    },
  };
}

async function tryUpdate({ url, headers, bodyObj, method }) {
  return fetchRaw(url, {
    method,
    headers,
    body: JSON.stringify(bodyObj),
  });
}

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const { token, imsOrg } = requireIms(params);
    const authHeader = normalizeBearer(token);

    const templateId = params.templateId;
    if (!templateId) return badRequest("Missing templateId");

    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const updateUrl = buildUpdateUrl(params, templateId);
    if (!updateUrl) return serverError("Missing AJO_GET_TEMPLATE_URL (or AJO_UPDATE_TEMPLATE_URL)");

    // If html/editorContext not provided, fetch existing so we can safely update name/labels only.
    let existing = null;
    let html = coerceHtml(params);
    let editorContext = params.editorContext || null;
    let etag = null;

    // If caller provides ifMatch, we can skip GET *if* they also provide html + editorContext.
    // Otherwise we must GET so we can:
    //  - obtain the ETag
    //  - preserve html/editorContext on name/label-only updates
    const needsGet = !params.ifMatch || !html || !editorContext;

    if (needsGet) {
      const getResp = await fetchRaw(updateUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "x-gw-ims-org-id": imsOrg,
          "x-api-key": params.AJO_API_KEY,
          "x-sandbox-name": params.SANDBOX_NAME,
          accept: "application/vnd.adobe.ajo.template.v1+json",
        },
      });

      existing = getResp?.data || null;
      etag = pickEtag(getResp?.headers || {}) || null;

      if (!html) {
        html = existing?.template?.html?.body ?? existing?.template?.html ?? null;
      }
      if (!editorContext) {
        editorContext = existing?.template?.editorContext ?? {};
      }
    }

    const bodyObj = buildUpdateBody({ existing, params, html, editorContext });

    const ifMatch = params.ifMatch || etag;
    if (!ifMatch) {
      return serverError(
        "Missing ETag for update. AJO requires If-Match; GET did not return an ETag header."
      );
    }

    const commonHeaders = {
      Authorization: authHeader,
      "x-gw-ims-org-id": imsOrg,
      "x-api-key": params.AJO_API_KEY,
      "x-sandbox-name": params.SANDBOX_NAME,
      "content-type": "application/vnd.adobe.ajo.template.v1+json",
      accept: "application/vnd.adobe.ajo.template.v1+json",
      "If-Match": ifMatch,
    };

    // Default to PUT; if the endpoint responds 405, fall back to PATCH.
    const preferredMethod = (params.updateMethod || "PUT").toUpperCase();

    let resp = await tryUpdate({
      url: updateUrl,
      headers: commonHeaders,
      bodyObj,
      method: preferredMethod,
    });

    if (resp?.status === 405 && preferredMethod !== "PATCH") {
      resp = await tryUpdate({
        url: updateUrl,
        headers: commonHeaders,
        bodyObj,
        method: "PATCH",
      });
    }

    const location = resp?.headers?.location || resp?.headers?.["content-location"] || null;

    // Note: Some AJO endpoints return empty body; we surface status + location + any parsed data.
    return ok({
      message: "Template Update Successful",
      templateId,
      status: resp?.status ?? null,
      location,
      etagUsed: ifMatch,
      result: resp?.data ?? null,
      responseText: resp?.text ?? null,
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