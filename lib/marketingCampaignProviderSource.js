import { buildTemplateSnapshotFromTemplate } from "./marketingCampaignTemplateRenderer.js";
import { replaceRecipientPlaceholders } from "./marketingRecipientPersonalization.js";

function sameSourceVersion(campaign = {}, template = {}) {
  const snapshot = campaign.template_snapshot || {};
  const sourceId = String(snapshot.source_template_id || campaign.template_id || "");
  const sourceUpdatedAt = String(snapshot.source_template_updated_at || "");
  return Boolean(sourceId)
    && sourceId === String(template.id || "")
    && Boolean(sourceUpdatedAt)
    && sourceUpdatedAt === String(template.updated_at || "");
}

function restoreRawOverride(value, rawValue, template = {}) {
  const designerValue = replaceRecipientPlaceholders(rawValue, {
    first_name: "Alex",
    company: template.company_name,
    company_name: template.company_name,
  }, { mode: "designer_preview" });
  return String(value || "") === designerValue ? rawValue : value;
}

export function campaignFromOriginalTemplateSource(campaign = {}, template = {}) {
  if (!sameSourceVersion(campaign, template)) {
    return { campaign, refreshed: false, reason: "source_version_mismatch" };
  }
  const templateSnapshot = buildTemplateSnapshotFromTemplate(template);
  const {
    preview: _preview,
    html: _html,
    rendered_html: _renderedHtml,
    renderedHtml: _renderedHtmlCamel,
    ...campaignStructure
  } = campaign;
  return {
    refreshed: true,
    reason: "matching_original_template_source",
    campaign: {
      ...campaignStructure,
      template_snapshot: templateSnapshot,
      subject_line: restoreRawOverride(campaign.subject_line, templateSnapshot.default_subject, template),
      preview_text: restoreRawOverride(campaign.preview_text, templateSnapshot.preview_text, template),
    },
  };
}
