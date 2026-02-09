// File: src/dx-excshell-1/actions/aem/prb-list/index.js

const { ok, badGateway, corsPreflight } = require("../../_lib/http");
const { postGql } = require("../../_lib/aemGql");

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

    return ok(data);
  } catch (e) {
    return badGateway(e.message, { data: e.data, responseText: e.responseText });
  }
}

exports.main = main;