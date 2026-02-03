const fetch = require("node-fetch");

exports.main = async () => {
  try {
    const gqlUrl = process.env.AEM_GRAPHQL_AUTHOR_URL;

    if (!gqlUrl) {
      return {
        statusCode: 500,
        body: { ok: false, error: "Missing env var AEM_GRAPHQL_AUTHOR_URL" }
      };
    }

    if (!/^https?:\/\//i.test(gqlUrl)) {
      return {
        statusCode: 500,
        body: { ok: false, error: "AEM_GRAPHQL_AUTHOR_URL must start with http(s)://", gqlUrl }
      };
    }

    const query = `
      query {
        unifiedPromotionalContentsList(limit: 5) {
          items { _path _id headlineText }
        }
      }
    `;

    const resp = await fetch(gqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query })
    });

    const text = await resp.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }

    return { statusCode: resp.status, body: json ?? { raw: text } };
  } catch (e) {
    return { statusCode: 500, body: { ok: false, error: e.message } };
  }
};
