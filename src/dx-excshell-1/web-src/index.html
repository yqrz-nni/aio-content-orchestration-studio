const fetch = require("node-fetch");

exports.main = async () => {
  try {
    const gqlUrl = process.env.AEM_GRAPHQL_AUTHOR_URL;

    if (!gqlUrl) {
      return {
        statusCode: 500,
        body: { ok: false, error: "Missing env var: AEM_GRAPHQL_AUTHOR_URL" }
      };
    }

    if (!/^https?:\/\//i.test(gqlUrl)) {
      return {
        statusCode: 500,
        body: {
          ok: false,
          error: "AEM_GRAPHQL_AUTHOR_URL must be an absolute URL starting with http(s)://",
          gqlUrl
        }
      };
    }

    // IMPORTANT: match the exact query shape that works in your AEM GraphiQL,
    // including "limit" vs "first" and field names.
    const query = `
      query {
        unifiedPromotionalContentsList(limit: 5) {
          items {
            _path
            _id
            headlineText
          }
        }
      }
    `;

    const resp = await fetch(gqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
        // If your Author GraphQL requires auth, we’ll add Authorization here later.
      },
      body: JSON.stringify({ query })
    });

    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // leave json null, return raw
    }

    return {
      statusCode: resp.status,
      body: json ?? { raw: text }
    };
  } catch (e) {
    return { statusCode: 500, body: { ok: false, error: e.message } };
  }
};
