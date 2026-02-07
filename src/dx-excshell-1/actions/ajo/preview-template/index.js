const {
  ok,
  badRequest,
  serverError,
  badGateway,
  corsPreflight,
} = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");
const { requireIms } = require("../../_lib/ims");

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const { token, imsOrg } = requireIms(params);
    const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    if (!params.AJO_MESSAGE_GQL_URL) return serverError("Missing AJO_MESSAGE_GQL_URL");
    if (!params.AJO_API_KEY) return serverError("Missing AJO_API_KEY");
    if (!params.SANDBOX_NAME) return serverError("Missing SANDBOX_NAME");

    const templateId = params.templateId;
    const profileId = params.profileId;

    if (!templateId) return badRequest("Missing templateId");
    if (!profileId) return badRequest("Missing profileId");

    const gqlBody = {
      operationName: "ajoContentPreview",
      query: `
        query ajoContentPreview($options: AjoContentPreviewOptionsInput!) {
          ajoContentPreview(contentPreviewOptions: $options) {
            ... on AjoPreviewRenderedEmail {
              variantId
              name
              subject
              html { body }
              text { body }
            }
          }
        }
      `,
      variables: {
        options: {
          resourceId: { id: templateId, type: "TEMPLATE" },
          channel: "EMAIL",
          profileId,
        },
      },
    };

    const data = await fetchJson(params.AJO_MESSAGE_GQL_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "x-gw-ims-org-id": imsOrg,
        "x-api-key": "cjm-authoring-ui",
        "x-sandbox-name": params.SANDBOX_NAME,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(gqlBody),
    });

    if (data?.errors?.length) {
      return badGateway("GraphQL returned errors", { errors: data.errors });
    }

    const rendered = data?.data?.ajoContentPreview;
    if (!rendered?.html?.body) {
      return badGateway("Preview returned no HTML body", { raw: rendered });
    }

    return ok({
      templateId,
      profileId,
      variantId: rendered.variantId,
      name: rendered.name,
      subject: rendered.subject,
      html: rendered.html.body,
      text: rendered?.text?.body ?? null,
    });
  } catch (e) {
    return serverError(e.message, {
      url: e.url,
      status: e.status,
      responseText: e.responseText,
      data: e.data,
    });
  }
}

exports.main = main;