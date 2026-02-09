// File: src/dx-excshell-1/actions/ajo/template/render/index.js

const {
  ok,
  badRequest,
  serverError,
  corsPreflight,
} = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { requireIms } = require("../../../_lib/ims");

/**
 * Normalize Bearer token for Authorization header.
 */
function normalizeBearer(token) {
  return token?.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/**
 * Extract IMS org and token from request (your helper does this).
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
  return (
    headers.etag ||
    headers.ETag ||
    headers["etag"] ||
    headers["ETag"] ||
    null
  );
}

/**
 * Some AJO template HTML embeds fragment ids like "ajo:<uuid>".
 * The REST endpoint you’re calling is /fragments/<uuid> (no "ajo:" prefix).
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
 * Matches: {{ fragment id="ajo:<uuid>" ... }} and {{fragment id='ajo:<uuid>' ...}}
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
async function fetchFragmentById({
  baseUrl,
  fragmentIdRaw,
  headers,
  accept = "application/vnd.adobe.ajo.fragment.v1.0+json",
}) {
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
      accept,
    },
  });

  return {
    id: resp?.data?.id || cleanId,
    name: resp?.data?.name || null,
    type: resp?.data?.type || null,
    channels: resp?.data?.channels || null,
    // For html fragments, content is commonly at fragment.content
    content:
      resp?.data?.fragment?.content ??
      resp?.data?.fragment?.processedContent ??
      null,
    raw: resp?.data || null,
  };
}

/**
 * V1 Render action:
 * - fetch template by templateId (canonical source)
 * - optionally resolve any referenced AJO fragments (for debugging / future inlining)
 * - return HTML + warnings + resolved fragment details
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    // IMS
    const { token, imsOrg } = requireIms(params);
    const authHeader = normalizeBearer(token);

    // Required inputs
    const templateId = params.templateId;
    if (!templateId) return badRequest("Missing templateId");

    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");
    if (!params.AJO_GET_TEMPLATE_URL)
      return serverError("Missing AJO_GET_TEMPLATE_URL");

    // Fetch template
    const templateUrl = `${params.AJO_GET_TEMPLATE_URL}/${templateId}`;

    const commonHeaders = buildCommonHeaders({
      authHeader,
      imsOrg,
      apiKey: params.AJO_API_KEY,
      sandboxName: params.SANDBOX_NAME,
    });

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

    // --- Optional: resolve fragment details for those referenced in HTML ---
    // Turn off if you don’t want to call fragments at all.
    const resolveFragments =
      params.resolveFragments === true || params.resolveFragments === "true";

    const resolutionWarnings = [];
    let fragmentsResolved = [];

    if (resolveFragments) {
      if (!params.AJO_GET_FRAGMENT_URL) {
        resolutionWarnings.push(
          "resolveFragments=true but AJO_GET_FRAGMENT_URL is missing"
        );
      } else {
        const fragmentIds = extractAjoFragmentIds(html);

        // Keep it safe for demo: cap number of fragment GETs
        const max = Number(params.maxFragmentsToResolve || 10);
        const toResolve = fragmentIds.slice(0, Math.max(0, max));

        const results = [];
        for (const fid of toResolve) {
          try {
            const frag = await fetchFragmentById({
              baseUrl: params.AJO_GET_FRAGMENT_URL,
              fragmentIdRaw: fid,
              headers: commonHeaders,
              accept: "application/vnd.adobe.ajo.fragment.v1.0+json",
            });
            results.push(frag);
          } catch (e) {
            resolutionWarnings.push(
              `Failed to resolve fragment ${fid}: ${e.message}`
            );
          }
        }

        fragmentsResolved = results;
        if (fragmentIds.length > toResolve.length) {
          resolutionWarnings.push(
            `Resolved ${toResolve.length}/${fragmentIds.length} fragments (capped by maxFragmentsToResolve=${max}).`
          );
        }
      }
    }

    // Keep response contract render-centric
    return ok({
      templateId,
      html,
      etag,
      resolveFragments,
      fragmentsResolved,
      resolutionWarnings,
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