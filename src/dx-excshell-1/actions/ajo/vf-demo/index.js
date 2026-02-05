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
    let headers = {
      "Content-Type": "application/json",
    };

    return json(200, "AJO DEMO!");
  } catch (error) {
    return json(500, { error: error.message });
  }
}

exports.main = main;