const { ok, badRequest, serverError, corsPreflight } = require("../../_lib/http");
const { requireIms } = require("../../_lib/ims");
const { renderTemplate } = require("./renderer");

/**
 * v1: render a template using a lightweight renderer
 *
 * Expected params (POST JSON):
 *  - templateHtml: string (required)  => the "template.html.body"
 *  - context: object (optional)       => { profile: {...}, cf: {...}, etc. }
 *  - vfs: array (optional)            => [{ key: "module1", html: "<div>...</div>" }, ...]
 *
 * Output:
 *  - { html: { body: "<!doctype...>" } }
 */
async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight({
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-gw-ims-org-id",
    });
  }

  try {
    // Require IMS headers so this can be safely invoked from your UI
    // (even if v1 doesn’t use token yet)
    requireIms(params);

    const templateHtml = params.templateHtml;
    if (!templateHtml || typeof templateHtml !== "string") {
      return badRequest("Missing templateHtml (string).");
    }

    const context = (params.context && typeof params.context === "object") ? params.context : {};
    const vfs = Array.isArray(params.vfs) ? params.vfs : [];

    // Build render context (you can standardize this structure over time)
    const renderCtx = {
      ...context,
      vfs: Object.fromEntries(
        vfs
          .filter(v => v && typeof v.key === "string")
          .map(v => [v.key, v.html ?? ""])
      ),
    };

    // Render
    const body = renderTemplate(templateHtml, renderCtx);

    return ok({
      subject: context?.subject ?? "",
      html: { body },
    }, {
      "access-control-allow-origin": "*",
    });
  } catch (e) {
    return serverError(e.message, {
      status: e.status,
      data: e.data,
    });
  }
}

exports.main = main;