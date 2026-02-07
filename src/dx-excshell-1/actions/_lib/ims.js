function getHeader(params, name) {
  const h = params?.__ow_headers || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()];
}

function getImsContext(params) {
  const auth =
    getHeader(params, "authorization") || getHeader(params, "Authorization");

  const imsOrg =
    getHeader(params, "x-gw-ims-org-id") ||
    getHeader(params, "X-GW-IMS-ORG-ID") ||
    getHeader(params, "x-ims-org-id") ||
    getHeader(params, "X-IMS-ORG-ID");

  const token = auth?.startsWith("Bearer ") ? auth : auth ? `Bearer ${auth}` : null;

  return { token, imsOrg };
}

function requireIms(params) {
  const { token, imsOrg } = getImsContext(params);
  if (!token || !imsOrg) {
    const e = new Error(
      "Missing Authorization (Bearer token) or x-gw-ims-org-id. Forward ims.token and ims.org from the UI."
    );
    e.status = 400;
    throw e;
  }
  return { token, imsOrg };
}

module.exports = { getImsContext, requireIms };