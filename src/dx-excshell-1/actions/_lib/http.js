// src/dx-excshell-1/actions/_lib/http.js

// Shared CORS headers for ALL responses
const DEFAULT_CORS_HEADERS = {
  // OK for local dev. Later you can restrict to your domain.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers":
    "Authorization,Content-Type,x-gw-ims-org-id,x-api-key,x-sandbox-name",
  "access-control-max-age": "86400",
};

function json(statusCode, bodyObj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...DEFAULT_CORS_HEADERS,
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
    headers: {
      ...DEFAULT_CORS_HEADERS,
      ...extraHeaders,
    },
    body: "",
  };
}

module.exports = {
  json,
  ok,
  badRequest,
  serverError,
  badGateway,
  corsPreflight,
};