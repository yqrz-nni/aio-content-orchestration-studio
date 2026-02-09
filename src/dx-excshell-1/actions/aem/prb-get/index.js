// File: src/dx-excshell-1/actions/aem/prb-get/index.js

const { ok, badRequest, badGateway, corsPreflight } = require("../../_lib/http");
const { postGql } = require("../../_lib/aemGql");

async function main(params) {
  if ((params.__ow_method || "").toUpperCase() === "OPTIONS") {
    return corsPreflight();
  }

  try {
    const id = params.id || params._id;
    if (!id) return badRequest("Missing id (AEM Content Fragment _id)");

    const query = `
      query GetFragmentById($id: String!) {
        prbPropertiesById(_id: $id) {
          item {
            _id
            _path
            prbNumber
            startingDate
            expirationDate
            name

            brandStyle {
              font_family
              email_banner_content_section_padding
              email_banner_content_bottom_margin
              email_banner_content_top_margin
              email_banner_content_right_margin
              email_banner_content_left_margin
              email_body_copy_line_height
              email_headline_line_height
              font_size_heading_xs
              font_size_heading_sm
              font_size_heading_med
              font_size_heading_lg
              font_size_heading_x1
              component_button_border_radius
              divider_weight
              divider_color
              color_text_body
              color_text_white
              color_text_link_secondary
              color_text_link_primary
              color_background_tertiary
              color_background_secondary
              color_background_primary
              color_text_tertiary
              color_text_secondary
              color_text_primary
            }

            brands {
              isiLink
              piLink
              indication
              homepageUrl
              icon
              displayName
              name
            }
          }
        }
      }
    `;

    const data = await postGql(params, { query, variables: { id } });

    if (data?.errors?.length) {
      return badGateway("GraphQL returned errors", { errors: data.errors });
    }

    const item = data?.data?.prbPropertiesById?.item || null;
    if (!item) {
      return badGateway("PRB not found for id", { id });
    }

    return ok({ item });
  } catch (e) {
    return badGateway(e.message, { data: e.data, responseText: e.responseText });
  }
}

exports.main = main;