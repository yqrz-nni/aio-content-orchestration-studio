function getPath(obj, path) {
  if (!path) return undefined;
  const parts = path.split(".").map(p => p.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * v1 rules:
 *  - {{{path}}} => raw (no escaping)
 *  - {{path}}   => escaped
 *  - supports dotted paths: profile.firstName, cf.headline, etc.
 *
 * Special:
 *  - allow embedding VFs by key: {{{
 *      vfs.module1
 *    }}}
 */
function renderTemplate(template, ctx) {
  let out = template;

  // Raw first (triple)
  out = out.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_, expr) => {
    const val = getPath(ctx, expr.trim());
    return val == null ? "" : String(val);
  });

  // Escaped (double)
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const val = getPath(ctx, expr.trim());
    return val == null ? "" : escapeHtml(val);
  });

  return out;
}

module.exports = { renderTemplate };