// File: src/dx-excshell-1/actions/_lib/aemGql.js

const auth = require("@adobe/jwt-auth");
const { fetchJson } = require("./fetchJson");

function buildGqlUrl(params) {
  const useProxy = params.USE_AEM_PROXY === "true";

  if (!params.AEM_GQL_PATH) throw new Error("Missing AEM_GQL_PATH");
  if (!params.AEM_AUTHOR && !useProxy) throw new Error("Missing AEM_AUTHOR");
  if (!params.AEM_GQL_PATH_PROXY && useProxy) throw new Error("Missing AEM_GQL_PATH_PROXY");

  return useProxy
    ? params.AEM_GQL_PATH_PROXY
    : new URL(params.AEM_GQL_PATH, params.AEM_AUTHOR).toString();
}

async function buildHeaders(params) {
  const useProxy = params.USE_AEM_PROXY === "true";
  const headers = { "content-type": "application/json" };
  if (useProxy) return headers;

  const required = [
    "IMS_HOST",
    "CLIENT_ID",
    "CLIENT_SECRET",
    "TECH_ACCOUNT_ID",
    "ORG_ID",
    "PRIVATE_KEY",
    "METASCOPES",
  ];
  for (const k of required) if (!params[k]) throw new Error(`Missing ${k}`);

  const accessTokenResp = await auth({
    imsHost: params.IMS_HOST,
    clientId: params.CLIENT_ID,
    clientSecret: params.CLIENT_SECRET,
    technicalAccountId: params.TECH_ACCOUNT_ID,
    orgId: params.ORG_ID,
    privateKey: (params.PRIVATE_KEY || "").replace(/\\r\\n/g, "\n"),
    metaScopes: params.METASCOPES,
  });

  const accessToken = accessTokenResp.access_token || accessTokenResp;

  headers.Authorization = `Bearer ${accessToken}`;
  headers["x-gw-ims-org-id"] = params.ORG_ID;
  headers["x-api-key"] = params.CLIENT_ID;

  return headers;
}

async function postGql(params, { query, variables }) {
  const url = buildGqlUrl(params);
  const headers = await buildHeaders(params);

  return fetchJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
}

module.exports = { postGql };