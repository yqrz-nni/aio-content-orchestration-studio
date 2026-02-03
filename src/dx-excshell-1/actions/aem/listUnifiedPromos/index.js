const fetch = require("node-fetch");

function mustGet(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

exports.main = async () => {
  try {
    const gqlUrl = mustGet("AEM_GRAPHQL_AUTHOR_URL");
    const token = mustGet("AEM_ACCESS_TOKEN");

    const query = `
      query {
        unifiedPromotionalContentsList(first: 5) {
          items {
            _id
            _path
            title
            heading
            eyebrowText
            ctaText
          }
        }
      }
    `;

    const resp = await fetch(gqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ query })
    });

    const json = await resp.json();

    return {
      statusCode: 200,
      body: {
        ok: true,
        raw: json
      }
    };
  } catch (e) {
    return { statusCode: 500, body: { ok: false, error: e.message } };
  }
};
