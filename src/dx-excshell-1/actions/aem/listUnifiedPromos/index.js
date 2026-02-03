// actions/aem/listUnifiedPromos/index.js

export async function main(params) {
  try {
    const aemUrl = params.AEM_GRAPHQL_AUTHOR_URL;
    if (!aemUrl) {
      return {
        statusCode: 500,
        body: { error: "Missing AEM_GRAPHQL_AUTHOR_URL input" }
      };
    }

    // Web actions typically provide request headers under __ow_headers
    const incomingAuth =
      params.__ow_headers?.authorization || params.__ow_headers?.Authorization;

    // TODO: replace these with your model/query details.
    // If you have a persisted query endpoint, you may not need a big query string here.
    const query = `
      query ListUnifiedPromos($limit: Int!) {
        unifiedPromotionalContentList(limit: $limit) {
          items {
            _path
            _id
            title
          }
        }
      }
    `;

    const body = JSON.stringify({
      query,
      variables: { limit: 5 }
    });

    const res = await fetch(aemUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(incomingAuth ? { Authorization: incomingAuth } : {})
      },
      body
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    // Return whatever AEM gave you (plus status) so your UI can display it
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json" },
      body: json ?? { raw: text }
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: { error: e?.message ?? String(e) }
    };
  }
}
