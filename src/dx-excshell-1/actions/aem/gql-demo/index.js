async function main(params) {
  console.log("GraphQL test action started");

  return {
    statusCode: 200,
    body: "ok"
  };
}

exports.main = main;