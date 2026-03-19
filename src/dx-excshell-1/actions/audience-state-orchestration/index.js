async function main(params) {
  // simple hello world action for the Audience State Orchestration Studio demo
  return {
    statusCode: 200,
    body: {
      message: 'Hello from Audience State Orchestration Studio!'
    }
  }
}

exports.main = main;
