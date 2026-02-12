const auth = require("@adobe/jwt-auth");
const {
  ok,
  badRequest,
  serverError,
  badGateway,
  corsPreflight,
} = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");

function applyUrlTemplate(template, vars = {}) {
  if (!template) return null;
  const raw = String(template || "").trim();
  if (!raw) return null;
  return raw.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key) => {
    const val = vars[key];
    return val == null ? "" : String(val);
  });
}

function buildAemCfDeepLink({ prefix, template, authorBase, id, path }) {
  const cleanPrefix = String(prefix || "").trim();
  if (cleanPrefix && id) return `${cleanPrefix}${encodeURIComponent(String(id))}`;
  if (template) {
    return applyUrlTemplate(template, {
      id: String(id || ""),
      path: String(path || ""),
      idEncoded: encodeURIComponent(String(id || "")),
      pathEncoded: encodeURIComponent(String(path || "")),
    });
  }
  if (authorBase && path) {
    const u = new URL(String(authorBase));
    u.pathname = `/assets.html${String(path)}`;
    return u.toString();
  }
  return null;
}

async function main(params) {
  // ✅ Handle browser preflight
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const useProxy = params.USE_AEM_PROXY === "true";

    if (!params.AEM_GQL_PATH) return serverError("Missing AEM_GQL_PATH");
    if (!params.AEM_AUTHOR && !useProxy) return serverError("Missing AEM_AUTHOR");
    if (!params.AEM_GQL_PATH_PROXY && useProxy) return serverError("Missing AEM_GQL_PATH_PROXY");

    const gqlUrl = useProxy
      ? params.AEM_GQL_PATH_PROXY
      : new URL(params.AEM_GQL_PATH, params.AEM_AUTHOR).toString();

    const headers = {
      "content-type": "application/json",
    };

    // Only mint token if NOT using proxy
    if (!useProxy) {
      // Basic param validation
      if (!params.IMS_HOST) return serverError("Missing IMS_HOST");
      if (!params.CLIENT_ID) return serverError("Missing CLIENT_ID");
      if (!params.CLIENT_SECRET) return serverError("Missing CLIENT_SECRET");
      if (!params.TECH_ACCOUNT_ID) return serverError("Missing TECH_ACCOUNT_ID");
      if (!params.ORG_ID) return serverError("Missing ORG_ID");
      if (!params.PRIVATE_KEY) return serverError("Missing PRIVATE_KEY");
      if (!params.METASCOPES) return serverError("Missing METASCOPES");

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
    }

    const query = `
      query {
        unifiedPromotionalContentList(limit: 50) {
          items {
            _path
            _id
            headlineText
            bodyCopy {
              html
              plaintext
            }
            references {
              referenceNote
            }
          }
        }
      }
    `;

    const data = await fetchJson(gqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });

    // Optional: GraphQL servers sometimes return 200 + errors[]
    if (data?.errors?.length) {
      return badGateway("GraphQL returned errors", { errors: data.errors });
    }

    const list = data?.data?.unifiedPromotionalContentList;
    const rawItems = Array.isArray(list?.items) ? list.items : [];
    const linkedItems = rawItems.map((it) => ({
      ...it,
      deepLinkUrl: buildAemCfDeepLink({
        prefix: params.AEM_CF_DETAIL_URL_PREFIX,
        template: params.AEM_CF_DEEPLINK_TEMPLATE,
        authorBase: params.AEM_AUTHOR,
        id: it?._id,
        path: it?._path,
      }),
    }));

    return ok({
      ...data,
      data: {
        ...(data?.data || {}),
        unifiedPromotionalContentList: {
          ...(list || {}),
          items: linkedItems,
        },
      },
      deepLinkConfig: {
        cfDetailUrlPrefix: params.AEM_CF_DETAIL_URL_PREFIX || null,
        cfTemplate: params.AEM_CF_DEEPLINK_TEMPLATE || null,
        aemAuthor: params.AEM_AUTHOR || null,
      },
    });
  } catch (e) {
    // If the upstream call failed, treat as 502; otherwise 500.
    const status = e.status || 500;
    const responder = status >= 400 && status < 600 ? badGateway : serverError;

    return responder(e.message, {
      url: e.url,
      status: e.status,
      responseText: e.responseText,
      data: e.data,
    });
  }
}

exports.main = main;
