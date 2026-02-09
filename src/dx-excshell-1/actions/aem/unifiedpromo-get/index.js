// File: src/dx-excshell-1/actions/aem/unifiedpromo-get/index.js

const { ok, badRequest, badGateway, corsPreflight } = require("../../_lib/http");
const { postGql } = require("../../_lib/aemGql");

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const id = params.id || params._id;
    if (!id) return badRequest("Missing id (AEM Content Fragment _id)");

    const query = `
      query GetFragmentById($id: String!) {
        unifiedPromotionalContentById(_id: $id) {
          item {
            _id
            _path
            eyebrowText
            headlineText
            bodyCopy
            primaryImage
            ctaText
            ctaLink
            localFootnote
            references { referenceNote }
            localReferences { referenceNote }
          }
        }
      }
    `;

    const data = await postGql(params, { query, variables: { id } });

    if (data?.errors?.length) {
      return badGateway("GraphQL returned errors", { errors: data.errors });
    }

    const item = data?.data?.unifiedPromotionalContentById?.item || null;
    if (!item) {
      return badGateway("Unified promo not found for id", { id });
    }

    return ok({ item });
  } catch (e) {
    return badGateway(e.message, { data: e.data, responseText: e.responseText });
  }
}

exports.main = main;