const fetch = require("node-fetch");
const auth = require("@adobe/jwt-auth");
const { json, badRequest, serverError } = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");

async function main(params) {
  try {
    const useProxy = params.USE_AEM_PROXY === "true";

    const gqlUrl = useProxy
      ? params.AEM_GQL_PATH_PROXY
      : new URL(params.AEM_GQL_PATH, params.AEM_AUTHOR).toString();

    let headers = {
      "Content-Type": "application/json",
    };

    // Only mint token if NOT using proxy
    if (!useProxy) {
      const accessTokenResp = await auth({
        imsHost: params.IMS_HOST,
        clientId: params.CLIENT_ID,
        clientSecret: params.CLIENT_SECRET,
        technicalAccountId: params.TECH_ACCOUNT_ID,
        orgId: params.ORG_ID,
        privateKey: (params.PRIVATE_KEY || "").replace(/\\r\\n/g, "\n"),
        metaScopes: params.METASCOPES,
      });

      const accessToken =
        accessTokenResp.access_token || accessTokenResp;

      headers.Authorization = `Bearer ${accessToken}`;
      headers["x-gw-ims-org-id"] = params.ORG_ID;
      headers["x-api-key"] = params.CLIENT_ID;
    }

    const query = `
      query {
        unifiedPromotionalContentList(limit: 5) {
          items { _path _id headlineText }
        }
      }
    `;

    const r = await fetch(gqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });

    const text = await r.text();
    if (!r.ok) return json(r.status, { error: text });

    return json(200, JSON.parse(text));
  } catch (error) {
    return json(500, { error: error.message });
  }
}

exports.main = main;