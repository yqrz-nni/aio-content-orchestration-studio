// File: src/dx-excshell-1/actions/aem/prb-list/index.js

const { ok, badGateway, corsPreflight } = require("../../_lib/http");
const { postGql } = require("../../_lib/aemGql");

function buildDeepLinkFromPrefix(prefix, id) {
  const p = String(prefix || "").trim();
  const v = String(id || "").trim();
  if (!p || !v) return null;
  return `${p}${encodeURIComponent(v)}`;
}

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const query = `
      query {
        prbPropertiesList(limit: 50) {
          items { _id _path prbNumber startingDate expirationDate name }
        }
      }
    `;

    const data = await postGql(params, { query });

    if (data?.errors?.length) {
      return badGateway("GraphQL returned errors", { errors: data.errors });
    }

    const list = data?.data?.prbPropertiesList;
    const items = Array.isArray(list?.items) ? list.items : [];
    const linked = items.map((it) => ({
      ...it,
      deepLinkUrl: buildDeepLinkFromPrefix(params.AEM_CF_DETAIL_URL_PREFIX, it?._id),
    }));

    return ok({
      ...data,
      data: {
        ...(data?.data || {}),
        prbPropertiesList: {
          ...(list || {}),
          items: linked,
        },
      },
      deepLinkConfig: {
        cfDetailUrlPrefix: params.AEM_CF_DETAIL_URL_PREFIX || null,
      },
    });
  } catch (e) {
    return badGateway(e.message, { data: e.data, responseText: e.responseText });
  }
}

exports.main = main;
