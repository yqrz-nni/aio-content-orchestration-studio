const fetch = require("node-fetch");

exports.main = async () => {
  try {
    const gqlUrl = process.env.AEM_GRAPHQL_AUTHOR_URL;

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
        // leave auth out for the first test
      },
      body: JSON.stringify({ query })
    });

    const text = await resp.text();

    return {
      statusCode: resp.status,
      body: { raw: text }
    };
  } catch (e) {
    return { statusCode: 500, body: { error: e.message } };
  }
};
