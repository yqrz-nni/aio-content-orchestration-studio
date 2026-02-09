// File: src/dx-excshell-1/actions/ajo/template/render/queries/unifiedPromotionalContent.gql.js

/**
 * Unified Promotional Content selection set
 * IMPORTANT: includes bodyCopy (MultiFormat-like) so AJO-style rendering can use `.html`.
 */
const unifiedPromotionalContentSelection = `
  _id
  _path

  bodyCopy {
    html
    markdown
    plaintext
    json
  }

  primaryImage {
    ... on ImageRef { _path }
  }

  references { referenceNote }

  headlineText
  ctaText
  ctaLink

  ctaImage {
    ... on ImageRef { _path }
  }

  localFootnote
  localReferences { referenceNote }

  eyebrowText
  keyMessageCategory
  triggersBoxedWarning
  imageReferencePlaceholders
  moduleId

  forceBrandStylingLeaveBlankToInheritContextualBrandStyle {
    _path
    _id
    _variation
    color_text_primary
    color_text_secondary
    color_text_tertiary
    color_background_primary
    color_background_secondary
    color_background_tertiary
    color_text_link_primary
    color_text_link_secondary
    color_text_white
    color_text_body
    divider_color
    divider_weight
    component_button_border_radius
    font_size_heading_x1
    font_size_heading_lg
    font_size_heading_med
    font_size_heading_sm
    font_size_heading_xs
    font_family
    email_headline_line_height
    email_body_copy_line_height
    email_banner_content_left_margin
    email_banner_content_right_margin
    email_banner_content_top_margin
    email_banner_content_bottom_margin
    email_banner_content_section_padding
  }
`;

module.exports = { unifiedPromotionalContentSelection };