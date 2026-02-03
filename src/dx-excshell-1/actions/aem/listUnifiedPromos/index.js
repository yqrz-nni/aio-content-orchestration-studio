/**
 * Adobe I/O Runtime action: listUnifiedPromos
 *
 * Expected inputs (set via ext.config.yaml / runtime):
 * - AEM_GRAPHQL_AUTHOR_URL : full URL to your AEM GraphQL endpoint
 *
 * Notes:
 * - This action accepts BOTH GET and POST from the UI, but the UI should use POST.
 * - This action calls AEM GraphQL using POST (required for normal GraphQL).
 * - If your AEM endpoint requires auth, ensure your action has `require-adobe-auth: true`
 *   so an Authorization header arrives in params.__ow_headers.
 */

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // Helpful during local dev:
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body
  };
}

function getIncomingAuth(params) {
  const h = params?.__ow_headers || {};
  return h.authorization || h.Authorization || null;
}

function getMethod(params) {
  return (params?.__ow_method || "post").toLowerCase();
}

function parseBodyParams(params) {
  // Web actions sometimes provide body as a string in __ow_body
  // and sometimes already merged into params.
  const raw = params?.__ow_body;

  if (raw && typeof raw === "string") {
    try {
      const parsed = JSON.pa
