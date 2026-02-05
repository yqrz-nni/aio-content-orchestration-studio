const fetch = require("node-fetch");
const auth = require("@adobe/jwt-auth");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body,
  };
}

async function main(params) {
    try {
        // 1) Exchange JWT creds for IMS access token
        const accessTokenResp = await auth({
            imsHost: params.IMS_HOST,                 // e.g. ims-na1.adobelogin.com
            clientId: params.CLIENT_ID,
            clientSecret: params.CLIENT_SECRET,
            technicalAccountId: params.TECH_ACCOUNT_ID, // your "id" (…@techacct.adobe.com)
            orgId: params.ORG_ID,                     // …@AdobeOrg
            privateKey: (params.PRIVATE_KEY || "").replace(/\\r\\n/g, "\n"),
            metaScopes: params.METASCOPES
        });
        const accessToken = accessTokenResp.access_token || accessTokenResp;
        // 2) Call AEM GraphQL (Author)
        const gqlUrl = `${params.AEM_AUTHOR}${params.AEM_GQL_PATH}`;
        const query = `
            query {
                unifiedPromotionalContentList(limit: 5) {
                    items {
                        _path
                        _id
                        headlineText
                    }
                }
            }
        `;
        const r = await fetch(gqlUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
                "x-gw-ims-org-id": params.ORG_ID,
                "x-api-key": params.CLIENT_ID
            },
            body: JSON.stringify({ query })
        });
        const text = await r.text();
        if (!r.ok) {
            return { statusCode: r.status, body: { error: text } };
        }
        return json(200, { message: JSON.parse(text) });
    } catch (error) {
      return json(500, { error: error.message });
    }
};

exports.main = main;