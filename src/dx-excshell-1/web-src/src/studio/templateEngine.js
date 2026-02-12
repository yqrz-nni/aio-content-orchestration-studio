// File: src/dx-excshell-1/web-src/src/studio/templateEngine.js

/* =============================================================================
 * Template engine: headers, HTML mutations, hydration (best-effort)
 * ============================================================================= */

function escapeAjoAttrValue(val) {
  return String(val ?? "").replace(/"/g, "&quot;");
}

function wrapAcrFragmentTag(rawTag) {
  return `{{!-- [acr-start-fragment] --}}${rawTag}{{!-- [acr-end-fragment] --}}`;
}

function buildAcrWrappedAjoFragmentTag(vfId, vfName = null) {
  const safeName = typeof vfName === "string" && vfName.trim() ? ` name="${escapeAjoAttrValue(vfName.trim())}"` : "";
  const raw = `{{ fragment id="ajo:${vfId}"${safeName} mode="inline" }}`;
  return wrapAcrFragmentTag(raw);
}

function buildAemCfFragmentTag({ aemCfId, repoId, vars = {} }) {
  const varAttrs = Object.entries(vars)
    .map(([k, v]) => `${k}='${String(v ?? "")}'`)
    .join(" ");
  const extraAttrs = varAttrs ? ` ${varAttrs}` : "";
  return `{{fragment id='aem:${aemCfId}?repoId=${repoId}' result='cf'${extraAttrs} r1=r1 r2=r2 r3=r3 r4=r4 r5=r5 r6=r6 r7=r7 r8=r8 r9=r9 r10=r10}}`;
}

function wrapAcrExprField(rawTag) {
  return `{{!-- [acr-start-expr-field] --}}${rawTag}{{!-- [acr-end-expr-field] --}}`;
}

// Deterministic PRB replacement: replace any existing prbProperties AEM binding
export function applyPrbToTemplateHtml(html, { prbCfId, repoId }) {
  if (!html) return html;

  const newCall = `{{fragment id='aem:${prbCfId}?repoId=${repoId}' result='prbProperties'}}`;
  const wrappedNewCall = wrapAcrExprField(newCall);

  const re = /{{\s*fragment\s+id=(['"])aem:[^'"]+\?repoId=[^'"]+\1\s+result=(['"])prbProperties\2\s*}}/;
  const wrappedRe =
    /{{!--\s*\[acr-start-expr-field\]\s*--}}\s*{{\s*fragment\s+id=(['"])aem:[^'"]+\?repoId=[^'"]+\1\s+result=(['"])prbProperties\2\s*}}\s*{{!--\s*\[acr-end-expr-field\]\s*--}}/;

  if (!wrappedRe.test(html) && !re.test(html)) {
    // eslint-disable-next-line no-console
    console.warn("Baseline HTML did not contain prbProperties binding; refusing to inject automatically.");
    return html;
  }

  if (wrappedRe.test(html)) {
    return html.replace(new RegExp(wrappedRe.source, "g"), wrappedNewCall);
  }
  return html.replace(new RegExp(re.source, "g"), wrappedNewCall);
}

// v1 module insertion: append module block before the closing marker
export function appendModuleToTemplateHtml(html, { vfId, vfName = null, aemCfId, repoId, vars = {}, moduleId = null }) {
  // Optional marker comments (do not change sequential cf namespace model)
  const openMarker = moduleId ? `<!-- ts:module id="${moduleId}" -->` : "";
  const closeMarker = moduleId ? `<!-- ts:module-end id="${moduleId}" -->` : "";
  const cfTag = buildAemCfFragmentTag({ aemCfId, repoId, vars });
  const wrappedCfTag = wrapAcrExprField(cfTag);
  const wrappedVfTag = buildAcrWrappedAjoFragmentTag(vfId, vfName);

  const insertion = `
  ${openMarker}
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="640">
      <tbody>
        <tr role="presentation">
          <th class="colspan1">
            <div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false">
              <div class="text-container" data-contenteditable="true">
                <p>${wrappedCfTag}</p>
              </div>
            </div>
            ${wrappedVfTag}
          </th>
        </tr>
      </tbody>
    </table>
  </div>
  ${closeMarker}
  `;

  const marker = "</div></body></html>";
  if (html.includes(marker)) return html.replace(marker, `${insertion}${marker}`);
  return html + insertion;
}

// Append a pattern (VF) even before content is bound.
export function appendPatternOnlyToTemplateHtml(html, { vfId, vfName = null, moduleId = null }) {
  const openMarker = moduleId ? `<!-- ts:module id="${moduleId}" -->` : "";
  const closeMarker = moduleId ? `<!-- ts:module-end id="${moduleId}" -->` : "";
  const wrappedVfTag = buildAcrWrappedAjoFragmentTag(vfId, vfName);

  const insertion = `
  ${openMarker}
  <div class="acr-structure" data-structure-id="1-1-column" data-structure-name="richtext.structure_1_1_column">
    <table class="structure__table" align="center" cellpadding="0" cellspacing="0" border="0" width="640">
      <tbody>
        <tr role="presentation">
          <th class="colspan1">
            ${wrappedVfTag}
          </th>
        </tr>
      </tbody>
    </table>
  </div>
  ${closeMarker}
  `;

  const marker = "</div></body></html>";
  if (html.includes(marker)) return html.replace(marker, `${insertion}${marker}`);
  return html + insertion;
}

/**
 * Insert a pattern (VF) before an existing module marker.
 * Falls back to append when markers/target are missing.
 */
export function insertPatternBeforeModuleHtml(html, { vfId, vfName = null, moduleId = null, beforeModuleId = null }) {
  const appended = appendPatternOnlyToTemplateHtml(html, { vfId, vfName, moduleId });
  if (!html || !beforeModuleId || !moduleId) return appended;

  const targetOpen = `<!-- ts:module id="${beforeModuleId}" -->`;
  const insertOpen = `<!-- ts:module id="${moduleId}" -->`;
  const idx = html.indexOf(targetOpen);
  if (idx < 0) return appended;

  // Build insertion via append helper so we keep block shape consistent, then extract that block by marker.
  const start = appended.lastIndexOf(insertOpen);
  if (start < 0) return appended;
  const endMarker = `<!-- ts:module-end id="${moduleId}" -->`;
  const end = appended.indexOf(endMarker, start);
  if (end < 0) return appended;
  const block = appended.slice(start, end + endMarker.length);

  const withoutBlock = appended.slice(0, start) + appended.slice(end + endMarker.length);
  const targetIdx = withoutBlock.indexOf(targetOpen);
  if (targetIdx < 0) return appended;
  return withoutBlock.slice(0, targetIdx) + block + "\n" + withoutBlock.slice(targetIdx);
}

// Bind content into an existing module block (identified by marker comments).
// If markers aren’t found, fall back to appending a full module (safe but may duplicate layout).
export function bindContentInModuleHtml(html, { moduleId, vfId, vfName = null, aemCfId, repoId, vars = {} }) {
  if (!html || !moduleId) {
    return appendModuleToTemplateHtml(html, { vfId, vfName, aemCfId, repoId, vars, moduleId: moduleId || null });
  }

  const open = `<!-- ts:module id="${moduleId}" -->`;
  const close = `<!-- ts:module-end id="${moduleId}" -->`;

  const start = html.indexOf(open);
  const end = html.indexOf(close);

  if (start < 0 || end < 0 || end <= start) {
    return appendModuleToTemplateHtml(html, { vfId, vfName, aemCfId, repoId, vars, moduleId });
  }

  const block = html.slice(start, end + close.length);
  const cfTag = buildAemCfFragmentTag({ aemCfId, repoId, vars });
  const wrappedCfTag = wrapAcrExprField(cfTag);

  const cfRe = /{{\s*fragment\b[^}]*\bid=(['"])aem:[^'"]+\?repoId=[^'"]+\1[^}]*\bresult=(['"])cf\2[^}]*}}/gim;
  const wrappedCfRe =
    /{{!--\s*\[acr-start-expr-field\]\s*--}}\s*{{\s*fragment\b[^}]*\bid=(['"])aem:[^'"]+\?repoId=[^'"]+\1[^}]*\bresult=(['"])cf\2[^}]*}}\s*{{!--\s*\[acr-end-expr-field\]\s*--}}/gim;

  let nextBlock = block;
  if (wrappedCfRe.test(block)) {
    nextBlock = block.replace(wrappedCfRe, wrappedCfTag);
  } else if (cfRe.test(block)) {
    nextBlock = block.replace(cfRe, wrappedCfTag);
  } else {
    // Insert a basic text-container wrapper before the VF block/tag.
    const vfIncludeRe = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:[^'"]+\1[^}]*}}/i;
    const wrappedVfBlockRe =
      /{{!--\s*\[acr-start-fragment\]\s*--}}\s*{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:[^'"]+\1[^}]*}}\s*{{!--\s*\[acr-end-fragment\]\s*--}}/i;
    if (vfIncludeRe.test(block)) {
      const insert = `
            <div class="acr-fragment acr-component" data-component-id="text" data-contenteditable="false">
              <div class="text-container" data-contenteditable="true">
                <p>${wrappedCfTag}</p>
              </div>
            </div>
      `;
      if (wrappedVfBlockRe.test(block)) {
        nextBlock = block.replace(wrappedVfBlockRe, `${insert}\n            $&`);
      } else {
        nextBlock = block.replace(vfIncludeRe, (_m) => `${insert}\n            ${wrapAcrFragmentTag(_m)}`);
      }
    } else {
      return appendModuleToTemplateHtml(html, { vfId, vfName, aemCfId, repoId, vars, moduleId });
    }
  }

  return html.slice(0, start) + nextBlock + html.slice(end + close.length);
}

// Remove internal module marker comments for clean AJO output.
export function stripTsModuleMarkers(html) {
  if (!html) return html;
  return html
    .replace(/<!--\s*ts:module\s+id="[^"]+"\s*-->/gim, "")
    .replace(/<!--\s*ts:module-end\s+id="[^"]+"\s*-->/gim, "");
}

/**
 * Remove a module block from canonical HTML using ts:module markers.
 * If markers are missing, returns original HTML (safe).
 */
export function removeModuleFromTemplateHtml(html, moduleId) {
  if (!html || !moduleId) return html;

  const re = new RegExp(
    `<!--\\s*ts:module\\s+id="${moduleId}"\\s*-->[\\s\\S]*?<!--\\s*ts:module-end\\s+id="${moduleId}"\\s*-->\\s*`,
    "gim"
  );

  return html.replace(re, "");
}

/**
 * Reorder one module block by one step using ts:module markers.
 * Direction is "up" or "down". If move is invalid/no-op, returns original html.
 */
export function moveModuleInTemplateHtml(html, moduleId, direction) {
  if (!html || !moduleId) return html;
  if (direction !== "up" && direction !== "down") return html;

  const markerRe = /<!--\s*ts:module\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*ts:module-end\s+id="\1"\s*-->\s*/gim;
  const blocks = [];
  let m;
  while ((m = markerRe.exec(html)) !== null) {
    blocks.push({
      id: m[1],
      start: m.index,
      end: markerRe.lastIndex,
      raw: m[0],
    });
  }

  if (!blocks.length) return html;

  const idx = blocks.findIndex((b) => b.id === moduleId);
  if (idx < 0) return html;

  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= blocks.length) return html;

  const sorted = blocks.slice();
  const tmp = sorted[idx];
  sorted[idx] = sorted[targetIdx];
  sorted[targetIdx] = tmp;

  const firstStart = blocks[0].start;
  const lastEnd = blocks[blocks.length - 1].end;
  const prefix = html.slice(0, firstStart);
  const suffix = html.slice(lastEnd);
  const middle = sorted.map((b) => b.raw).join("");
  return `${prefix}${middle}${suffix}`;
}

/**
 * Hydrate state from an existing AJO template HTML.
 * Best-effort parsing:
 *  - PRB: result='prbProperties' binding => selectedPrbId
 *  - Modules: pairs (aem result='cf') with nearest subsequent (ajo fragment) in order
 *
 * ADDITIVE: if ts:module markers exist, we also capture VF-only modules (contentId=null).
 * This does NOT change sequential cf model; it just prevents “unbound patterns” from disappearing on reload.
 */
export function hydrateFromHtml(html) {
  const out = {
    prbCfId: null,
    modules: [], // [{ moduleId, vfId, contentId, vars }]
  };
  if (!html || typeof html !== "string") return out;

  // --- PRB ---
  {
    const prbRe = /{{\s*fragment\b[^}]*\bid=(['"])aem:([^'"]+)\1[^}]*\bresult=(['"])prbProperties\3[^}]*}}/i;
    const m = html.match(prbRe);
    if (m && m[2]) {
      const idPart = m[2].split("?")[0];
      out.prbCfId = idPart || null;
    }
  }

  // --- Gather all AEM CF bindings (result='cf') with index positions ---
  const cfBindings = [];
  {
    const re = /{{\s*fragment\b([^}]*)}}/gim;
    let m;
    while ((m = re.exec(html)) !== null) {
      const inside = m[1] || "";
      const idMatch = inside.match(/\bid\s*=\s*(['"])aem:([^'"]+)\1/i);
      const resultMatch = inside.match(/\bresult\s*=\s*(['"])([^'"]+)\1/i);
      if (!idMatch || !resultMatch) continue;

      const result = resultMatch[2];
      if (result !== "cf") continue;

      const raw = idMatch[2]; // "<ID>?repoId=..."
      const contentId = (raw.split("?")[0] || "").trim() || null;
      if (!contentId) continue;

      // parse simple vars (firstName etc) excluding r1..r10 and id/result
      const vars = {};
      const argRe = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:(['"])(.*?)\2|([^\s}]+))/g;
      let am;
      while ((am = argRe.exec(inside)) !== null) {
        const k = am[1];
        if (!k) continue;
        const lk = k.toLowerCase();
        if (lk === "id" || lk === "result") continue;
        if (/^r\d+$/.test(lk)) continue;

        const v = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
        vars[k] = v;
      }

      cfBindings.push({ start: m.index, end: re.lastIndex, contentId, vars });
    }
  }

  // --- Gather all AJO VF calls with index positions ---
  const vfCalls = [];
  {
    const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])(ajo:([^'"]+))\1[^}]*}}/gim;
    let m;
    while ((m = re.exec(html)) !== null) {
      vfCalls.push({ start: m.index, end: re.lastIndex, vfId: m[3] || null });
    }
  }

  // --- Pair each CF binding with the nearest subsequent VF call before the next CF binding ---
  for (let i = 0; i < cfBindings.length; i++) {
    const cf = cfBindings[i];
    const nextCfStart = i < cfBindings.length - 1 ? cfBindings[i + 1].start : Number.POSITIVE_INFINITY;

    const vf = vfCalls.find((v) => v.start >= cf.end && v.start < nextCfStart) || null;

    out.modules.push({
      moduleId: `hydr_${i}_${Date.now()}`,
      vfId: vf?.vfId || null,
      contentId: cf.contentId,
      vars: cf.vars || {},
    });
  }

  // --- ADDITIVE: parse ts:module markers to capture VF-only modules (and prefer stable module ids) ---
  const markerRe = /<!--\s*ts:module\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*ts:module-end\s+id="\1"\s*-->/gim;
  const marked = [];
  let mm;
  while ((mm = markerRe.exec(html)) !== null) {
    const moduleId = mm[1];
    const block = mm[2] || "";

    const vfMatch = block.match(/{{\s*fragment\b[^}]*\bid\s*=\s*(['"])ajo:([^'"]+)\1[^}]*}}/i);
    const vfId = vfMatch && vfMatch[2] ? vfMatch[2] : null;

    const cfMatch = block.match(
      /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])aem:([^'"]+)\1[^}]*\bresult\s*=\s*(['"])cf\3[^}]*}}/i
    );
    const contentId = cfMatch && cfMatch[2] ? (cfMatch[2].split("?")[0] || "").trim() : null;

    if (vfId) {
      marked.push({
        moduleId,
        vfId,
        contentId: contentId || null,
        vars: {},
      });
    }
  }

  if (marked.length) {
    const seen = new Set(marked.map((m) => m.moduleId));
    const legacy = out.modules.filter((m) => !seen.has(m.moduleId));
    out.modules = [...marked, ...legacy];
  }

  return out;
}
