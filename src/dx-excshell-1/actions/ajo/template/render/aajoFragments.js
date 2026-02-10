// File: src/dx-excshell-1/actions/ajo/template/render/aajoFragments.js

const { fetchRaw } = require("../../../_lib/fetchRaw");
const { stripAjoPrefix, buildFragmentGetUrl, escapeRegExp, mapLimit } = require("./utils");

function extractAjoFragmentIds(html) {
  if (!html || typeof html !== "string") return [];

  const ids = new Set();

  // Matches: {{ fragment id="ajo:<id>" ... }} (quote required)
  const re = /{{\s*fragment\b[^}]*\bid\s*=\s*(['"])(ajo:[^'"]+)\1/gi;

  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[2]) ids.add(m[2]);
  }

  return [...ids];
}

/**
 * Best-effort picker for fragment HTML/content across variant response shapes.
 * We keep it conservative: only return strings.
 */
function pickFragmentContent(data) {
  const candidates = [
    // What you already had
    data?.fragment?.content,
    data?.fragment?.processedContent,
    data?.fragment?.expression,
    data?.fragment?.content?.expression,

    // Common alternates seen in content APIs
    data?.fragment?.content?.html,
    data?.fragment?.content?.markup,
    data?.fragment?.content?.value,
    data?.fragment?.content?.body,

    // Sometimes channelized content is nested
    data?.fragment?.channels?.email?.content,
    data?.fragment?.channels?.email?.processedContent,
    data?.fragment?.channels?.email?.expression,
    data?.channels?.email?.content,
    data?.channels?.email?.processedContent,
    data?.channels?.email?.expression,

    // Sometimes it's tucked under "content" at root
    data?.content,
    data?.processedContent,
    data?.expression,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return null;
}

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

  const data = resp?.data || {};
  const content = pickFragmentContent(data);

  return {
    id: data?.id || cleanId,
    name: data?.name || null,
    type: data?.type || null,
    channels: data?.channels || null,
    content, // <- may be null if not found
  };
}

/**
 * Resolve all fragment ids referenced in html (parallelized).
 */
async function resolveFragmentsFromHtml({ html, params, commonHeaders }) {
  const resolutionWarnings = [];
  let fragmentsResolved = [];

  if (!params.AJO_GET_FRAGMENT_URL) {
    return {
      fragmentsResolved,
      resolutionWarnings: ["AJO_GET_FRAGMENT_URL is missing (cannot resolve fragments)."],
      fragmentIds: [],
    };
  }

  const fragmentIds = extractAjoFragmentIds(html);

  const max = Number(params.maxFragmentsToResolve || 25);
  const toResolve = fragmentIds.slice(0, Math.max(0, max));

  const concurrency = Number(params.ajoFragmentConcurrency || 8);

  const results = await mapLimit(toResolve, concurrency, async (fid) => {
    try {
      const frag = await fetchFragmentById({
        baseUrl: params.AJO_GET_FRAGMENT_URL,
        fragmentIdRaw: fid,
        headers: commonHeaders,
      });

      if (!frag?.content) {
        resolutionWarnings.push(
          `Resolved fragment ${fid} (${frag?.name || "unnamed"}) but found no usable HTML/content field; leaving tag unstitched.`
        );
      }

      return frag;
    } catch (e) {
      resolutionWarnings.push(`Failed to resolve fragment ${fid}: ${e.message}`);
      return null;
    }
  });

  fragmentsResolved = results.filter(Boolean);

  if (fragmentIds.length > toResolve.length) {
    resolutionWarnings.push(
      `Resolved ${toResolve.length}/${fragmentIds.length} fragments (capped by maxFragmentsToResolve=${max}).`
    );
  }

  return { fragmentsResolved, resolutionWarnings, fragmentIds };
}

/**
 * Replace {{ fragment id="ajo:..." ... }} occurrences with resolved HTML.
 * IMPORTANT:
 * - If a fragment resolves but content is missing, DO NOT replace (avoid deleting the tag).
 */
function stitchFragmentsIntoHtml(html, fragmentsResolved) {
  const stitchReport = {
    stitched: [],
    skippedMissingContent: [],
    attempted: [],
  };

  if (!html || !Array.isArray(fragmentsResolved) || fragmentsResolved.length === 0) {
    return { stitchedHtml: html, stitchReport };
  }

  let out = html;

  for (const frag of fragmentsResolved) {
    const rawId = `ajo:${frag.id}`;
    stitchReport.attempted.push(rawId);

    const replacement = typeof frag.content === "string" ? frag.content : null;

    // SAFETY: Never delete the original tag if we don't have replacement content.
    if (!replacement || !replacement.trim()) {
      stitchReport.skippedMissingContent.push(rawId);
      continue;
    }

    const re = new RegExp(
      `{{\\s*fragment\\b[^}]*\\bid\\s*=\\s*(['"])${escapeRegExp(rawId)}\\1[^}]*}}`,
      "gi"
    );

    const before = out;
    out = out.replace(re, replacement);

    if (out !== before) {
      stitchReport.stitched.push(rawId);
    }
  }

  return { stitchedHtml: out, stitchReport };
}

/**
 * Resolve + stitch recursively up to a max depth (handles nested fragments).
 */
async function resolveAndStitchRecursively({ html, params, commonHeaders }) {
  const maxDepth = Number(params.maxFragmentDepth || 3);

  let currentHtml = html;
  let allWarnings = [];
  const byId = new Map();

  const stitchReportAll = {
    depth: [],
    stitchedUnique: [],
    skippedMissingContentUnique: [],
  };

  for (let depth = 0; depth < maxDepth; depth++) {
    const { fragmentsResolved, resolutionWarnings } = await resolveFragmentsFromHtml({
      html: currentHtml,
      params,
      commonHeaders,
    });

    allWarnings = allWarnings.concat(resolutionWarnings || []);

    if (!fragmentsResolved || fragmentsResolved.length === 0) break;

    for (const f of fragmentsResolved) {
      if (f && f.id && !byId.has(f.id)) byId.set(f.id, f);
    }

    const stitched = stitchFragmentsIntoHtml(currentHtml, fragmentsResolved);
    const nextHtml = stitched.stitchedHtml;

    stitchReportAll.depth.push({
      depth,
      attempted: stitched.stitchReport.attempted,
      stitched: stitched.stitchReport.stitched,
      skippedMissingContent: stitched.stitchReport.skippedMissingContent,
    });

    if (stitched.stitchReport.stitched.length) {
      stitchReportAll.stitchedUnique.push(...stitched.stitchReport.stitched);
    }
    if (stitched.stitchReport.skippedMissingContent.length) {
      stitchReportAll.skippedMissingContentUnique.push(...stitched.stitchReport.skippedMissingContent);
    }

    if (nextHtml === currentHtml) break;
    currentHtml = nextHtml;
  }

  stitchReportAll.stitchedUnique = [...new Set(stitchReportAll.stitchedUnique)];
  stitchReportAll.skippedMissingContentUnique = [...new Set(stitchReportAll.skippedMissingContentUnique)];

  return {
    stitchedHtml: currentHtml,
    fragmentsResolvedAll: [...byId.values()],
    resolutionWarnings: allWarnings,
    stitchReport: stitchReportAll,
  };
}

/* =============================================================================
 * NEW: one-shot wrapper that returns VF diagnostics for the action response
 * ============================================================================= */

function summarizeVfState(html) {
  // returns ["ajo:<id>", ...]
  return extractAjoFragmentIds(html);
}

async function resolveStitchWithDiagnostics({ html, params, commonHeaders }) {
  const vfBefore = summarizeVfState(html);

  const stitched = await resolveAndStitchRecursively({ html, params, commonHeaders });

  const vfAfter = summarizeVfState(stitched.stitchedHtml);

  const fragmentsResolvedAll = (stitched.fragmentsResolvedAll || []).map((f) => ({
    id: `ajo:${f.id}`,
    name: f.name || null,
    type: f.type || null,
    hasContent: !!(f.content && String(f.content).trim()),
  }));

  return {
    stitchedHtml: stitched.stitchedHtml,
    resolutionWarnings: stitched.resolutionWarnings || [],
    stitchReport: stitched.stitchReport || null,
    vfDiag: {
      before: vfBefore,
      after: vfAfter,
      dropped: vfBefore.filter((id) => !vfAfter.includes(id)),
      added: vfAfter.filter((id) => !vfBefore.includes(id)),
    },
    fragmentsResolvedAll,
  };
}

module.exports = {
  extractAjoFragmentIds,
  fetchFragmentById,
  resolveFragmentsFromHtml,
  stitchFragmentsIntoHtml,
  resolveAndStitchRecursively,
  resolveStitchWithDiagnostics,
};