// File: src/dx-excshell-1/actions/ajo/template/render/index.js

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { requireIms } = require("../../../_lib/ims");

/**
 * Normalize Bearer token for Authorization header.
 */
function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/**
 * Build common IMS/AEP gateway headers.
 */
function buildCommonHeaders({ authHeader, imsOrg, apiKey, sandboxName }) {
  return {
    Authorization: authHeader,
    "x-gw-ims-org-id": imsOrg,
    "x-api-key": apiKey,
    "x-sandbox-name": sandboxName,
  };
}

/**
 * Return ETag from response headers (fetchRaw lowercases keys).
 */
function pickEtag(headers = {}) {
  return headers.etag || headers.ETag || headers["etag"] || headers["ETag"] || null;
}

/**
 * Some AJO HTML embeds fragment ids like "ajo:<uuid>".
 * REST endpoint is /fragments/<uuid> (no "ajo:" prefix).
 */
function stripAjoPrefix(id) {
  if (!id || typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.startsWith("ajo:") ? trimmed.slice("ajo:".length) : trimmed;
}

/**
 * Build a clean GET-by-id URL from a base that might include query params.
 * Example base:
 *   https://platform.adobe.io/ajo/content/fragments?orderBy=-modifiedAt&limit=20
 * For GET-by-id we must drop query params:
 *   https://platform.adobe.io/ajo/content/fragments/<id>
 */
function buildFragmentGetUrl(baseUrl, fragmentId) {
  if (!baseUrl) return null;

  const u = new URL(baseUrl);
  u.search = "";
  u.hash = "";

  const basePath = u.pathname.replace(/\/$/, "");
  u.pathname = `${basePath}/${encodeURIComponent(fragmentId)}`;

  return u.toString();
}

/**
 * Find AJO fragment ids referenced in template HTML.
 * Matches:
 *  - {{ fragment id="ajo:<uuid>" ... }}
 *  - {{fragment id='ajo:<uuid>' ...}}
 * Returns array of raw ids like "ajo:<uuid>".
 */
function extractAjoFragmentIds(html) {
  if (!html || typeof html !== "string") return [];

  const ids = new Set();
  const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])(ajo:[^'"]+)\1/gi;

  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[2]) ids.add(m[2]);
  }

  return [...ids];
}

/**
 * Fetch a single fragment detail (GET /fragments/<id>) and return useful fields.
 */
async function fetchFragmentById({ baseUrl, fragmentIdRaw, headers }) {
  const cleanId = stripAjoPrefix(fragmentIdRaw);
  if (!cleanId) {
    const e = new Error(`Invalid fragment id: ${fragmentIdRaw}`);
    e.status = 400;
    throw e;
  }

  const url = buildFragmentGetUrl(baseUrl, cleanId);
  if (!url) {
    const e = new Error("Missing AJO_GET_FRAGMENT_URL");
    e.status = 500;
    throw e;
  }

  const resp = await fetchRaw(url, {
    method: "GET",
    headers: {
      ...headers,
      accept: "application/vnd.adobe.ajo.fragment.v1.0+json",
    },
  });

  return {
    id: resp?.data?.id || cleanId,
    name: resp?.data?.name || null,
    type: resp?.data?.type || null,
    channels: resp?.data?.channels || null,
    content:
      resp?.data?.fragment?.content ??
      resp?.data?.fragment?.processedContent ??
      null,
  };
}

/**
 * Always resolve fragment details referenced in html.
 * (No HTML rewriting yet — just returns fragment metadata + content.)
 */
async function resolveFragmentsFromHtml({ html, params, commonHeaders }) {
  const resolutionWarnings = [];
  let fragmentsResolved = [];

  if (!params.AJO_GET_FRAGMENT_URL) {
    return {
      fragmentsResolved,
      resolutionWarnings: ["AJO_GET_FRAGMENT_URL is missing (cannot resolve fragments)."],
    };
  }

  const fragmentIds = extractAjoFragmentIds(html);

  const max = Number(params.maxFragmentsToResolve || 10);
  const toResolve = fragmentIds.slice(0, Math.max(0, max));

  const results = [];
  for (const fid of toResolve) {
    try {
      const frag = await fetchFragmentById({
        baseUrl: params.AJO_GET_FRAGMENT_URL,
        fragmentIdRaw: fid,
        headers: commonHeaders,
      });
      results.push(frag);
    } catch (e) {
      resolutionWarnings.push(`Failed to resolve fragment ${fid}: ${e.message}`);
    }
  }

  fragmentsResolved = results;

  if (fragmentIds.length > toResolve.length) {
    resolutionWarnings.push(
      `Resolved ${toResolve.length}/${fragmentIds.length} fragments (capped by maxFragmentsToResolve=${max}).`
    );
  }

  return { fragmentsResolved, resolutionWarnings };
}

/**
 * Render action:
 * Supports TWO modes:
 * 1) HTML mode (TemplateStudio preview): params.html
 * 2) templateId mode: fetch template from AJO by params.templateId
 *
 * Fragment resolution is ALWAYS ON.
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const { token, imsOrg } = requireIms(params);
    const authHeader = normalizeBearer(token);

    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const commonHeaders = buildCommonHeaders({
      authHeader,
      imsOrg,
      apiKey: params.AJO_API_KEY,
      sandboxName: params.SANDBOX_NAME,
    });

    const templateId = typeof params.templateId === "string" ? params.templateId : null;

    // -------- Mode A: HTML provided directly (current UI behavior) --------
    if (typeof params.html === "string" && params.html.trim()) {
      const html = params.html;

      const res = await resolveFragmentsFromHtml({ html, params, commonHeaders });

      return ok({
        mode: "html",
        templateId,
        html,
        etag: null,
        fragmentsResolved: res.fragmentsResolved,
        resolutionWarnings: res.resolutionWarnings,
      });
    }

    // -------- Mode B: templateId fetch from AJO --------
    if (!templateId) return badRequest("Missing templateId or html");
    if (!params.AJO_GET_TEMPLATE_URL) return serverError("Missing AJO_GET_TEMPLATE_URL");

    const templateUrl = `${params.AJO_GET_TEMPLATE_URL}/${templateId}`;

    const templateResp = await fetchRaw(templateUrl, {
      method: "GET",
      headers: {
        ...commonHeaders,
        accept: "application/vnd.adobe.ajo.template.v1+json",
      },
    });

    const data = templateResp?.data || null;

    const html =
      data?.template?.html?.body ??
      data?.template?.html ??
      null;

    if (!html) {
      return serverError("Template fetched but no template.html found", {
        templateId,
        keys: data ? Object.keys(data) : null,
      });
    }

    const etag = pickEtag(templateResp?.headers || null);

    const res = await resolveFragmentsFromHtml({ html, params, commonHeaders });

    return ok({
      mode: "templateId",
      templateId,
      html,
      etag,
      fragmentsResolved: res.fragmentsResolved,
      resolutionWarnings: res.resolutionWarnings,
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