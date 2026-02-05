const fetch = require("node-fetch");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body,
  };
}

async function main(params) {
    try {
        return json(200, { message: "AEM GraphQL Demo Action is working!" });
    } catch (error) {
      return json(500, { error: error.message });
    }
};

exports.main = main;