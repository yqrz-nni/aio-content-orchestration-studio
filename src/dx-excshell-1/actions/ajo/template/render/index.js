// File: src/dx-excshell-1/actions/ajo/template/render/index.js
//
// Render (preview) action with:
// 1) Optional UI-provided AEM bindingStream (no AEM calls when values provided)
// 2) Optional UI-provided AEM cache (reuse hydrated objects across renders)
// 3) Conditional AEM GraphQL hydration only for missing/insufficient bindings
// 4) Introspection disabled by default (opt-in via params.enableAemIntrospection=true)
// 5) Best-effort renderedHtml: resolves {{cf.*}} and {{prbProperties.*}} and {{styles.*}} by binding order
//
// NEW:
// - VF diagnostics around stitching: vfDiag + stitchReport + fragmentsResolvedAll

const { ok, badRequest, serverError, corsPreflight } = require("../../../_lib/http");
const { fetchRaw } = require("../../../_lib/fetchRaw");
const { requireIms } = require("../../../_lib/ims");

const { normalizeBearer, buildCommonHeaders, pickEtag } = require("./utils");
const { resolveStitchWithDiagnostics } = require("./aajoFragments");
const { resolveAemBindingValues } = require("./aemBindings");
const { buildRenderedHtmlBestEffort } = require("./renderTokens");

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

    // -------- Mode A: HTML provided directly --------
    if (typeof params.html === "string" && params.html.trim()) {
      const html = params.html;

      const diag = await resolveStitchWithDiagnostics({ html, params, commonHeaders });
      const aem = await resolveAemBindingValues({ stitchedHtml: diag.stitchedHtml, params });

      const renderedHtml = buildRenderedHtmlBestEffort({
        stitchedHtml: diag.stitchedHtml,
        aemBindingsEncountered: aem.aemBindingsEncountered,
        aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,
      });

      return ok({
        mode: "html",
        templateId,
        html,
        stitchedHtml: diag.stitchedHtml,
        renderedHtml,
        etag: null,

        // Back-compat: keep the old key too, but return the summarized version
        fragmentsResolved: diag.fragmentsResolvedAll,
        resolutionWarnings: diag.resolutionWarnings,

        // NEW diagnostics
        vfDiag: diag.vfDiag,
        stitchReport: diag.stitchReport,
        fragmentsResolvedAll: diag.fragmentsResolvedAll,

        aemBindingsEncountered: aem.aemBindingsEncountered,
        aemPrefetch: aem.aemPrefetch,
        aemCacheKeys: aem.aemCacheKeys,
        aemWarnings: aem.aemWarnings,
        aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,

        perf: {
          streamHits: aem.streamHits,
          cacheHits: aem.cacheHits,
          hydratedCount: aem.hydratedCount,
          totalBindings: aem.aemBindingsEncountered?.length || 0,
        },
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
    const html = data?.template?.html?.body ?? data?.template?.html ?? null;

    if (!html) {
      return serverError("Template fetched but no template.html found", {
        templateId,
        keys: data ? Object.keys(data) : null,
      });
    }

    const etag = pickEtag(templateResp?.headers || null);

    const diag = await resolveStitchWithDiagnostics({ html, params, commonHeaders });
    const aem = await resolveAemBindingValues({ stitchedHtml: diag.stitchedHtml, params });

    const renderedHtml = buildRenderedHtmlBestEffort({
      stitchedHtml: diag.stitchedHtml,
      aemBindingsEncountered: aem.aemBindingsEncountered,
      aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,
    });

    return ok({
      mode: "templateId",
      templateId,
      html,
      stitchedHtml: diag.stitchedHtml,
      renderedHtml,
      etag,

      // Back-compat: keep the old key too, but return the summarized version
      fragmentsResolved: diag.fragmentsResolvedAll,
      resolutionWarnings: diag.resolutionWarnings,

      // NEW diagnostics
      vfDiag: diag.vfDiag,
      stitchReport: diag.stitchReport,
      fragmentsResolvedAll: diag.fragmentsResolvedAll,

      aemBindingsEncountered: aem.aemBindingsEncountered,
      aemPrefetch: aem.aemPrefetch,
      aemCacheKeys: aem.aemCacheKeys,
      aemWarnings: aem.aemWarnings,
      aemPrefetchDataByStreamKey: aem.aemPrefetchDataByStreamKey,

      perf: {
        streamHits: aem.streamHits,
        cacheHits: aem.cacheHits,
        hydratedCount: aem.hydratedCount,
        totalBindings: aem.aemBindingsEncountered?.length || 0,
      },
    });
  } catch (e) {
    return serverError(e?.message || "Unexpected error", { stack: e?.stack });
  }
}

exports.main = main;