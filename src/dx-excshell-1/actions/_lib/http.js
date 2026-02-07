function json(statusCode, bodyObj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(bodyObj),
  };
}

function ok(bodyObj, extraHeaders) {
  return json(200, bodyObj, extraHeaders);
}

function badRequest(message, extra = {}) {
  return json(400, { error: message, ...extra });
}

function serverError(message, extra = {}) {
  return json(500, { error: message, ...extra });
}

function badGateway(message, extra = {}) {
  return json(502, { error: message, ...extra });
}

function corsPreflight(extraHeaders = {}) {
  return {
    statusCode: 204,
    headers: { ...extraHeaders },
    body: "",
  };
}

module.exports = { json, ok, badRequest, serverError, badGateway, corsPreflight };