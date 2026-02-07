if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
  return corsPreflight();
}
const { ok, json } = require("../../_lib/http");
const { fetchJson } = require("../../_lib/fetchJson");
const { requireIms } = require("../../_lib/ims");

async function main(params) {
  try {
    const { token, imsOrg } = requireIms(params);

    if (!params.AJO_MESSAGE_GQL_URL) {
      return json(500, { error: "Missing AJO_MESSAGE_GQL_URL" });
    }
    if (!params.AJO_API_KEY) {
      return json(500, { error: "Missing AJO_API_KEY" });
    }
    if (!params.SANDBOX_NAME) {
      return json(500, { error: "Missing SANDBOX_NAME" });
    }

    // Get from UI
    const templateId = params.templateId;
    const profileId = params.profileId;

    if (!templateId) return json(400, { error: "Missing templateId" });
    if (!profileId) return json(400, { error: "Missing profileId" });

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
        Authorization: token,
        "x-gw-ims-org-id": imsOrg,
        "x-api-key": "cjm-authoring-ui",
        "x-sandbox-name": params.SANDBOX_NAME,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(gqlBody),
    });

    // GraphQL-style errors can come back 200 with `errors`
    if (data?.errors?.length) {
      return json(502, { error: "GraphQL returned errors", errors: data.errors });
    }

    const rendered = data?.data?.ajoContentPreview;
    if (!rendered?.html?.body) {
      return json(502, { error: "Preview returned no HTML body", raw: rendered });
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
    return json(e.status || 500, {
      error: e.message,
      url: e.url,
      status: e.status,
      responseText: e.responseText
    });
  }
}

exports.main = main;