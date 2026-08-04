import { buildTemplateSnapshotFromTemplate } from "./marketingCampaignTemplateRenderer.js";
import { replaceRecipientPlaceholders } from "./marketingRecipientPersonalization.js";

export const PROVIDER_SOURCE_LOAD_ERROR = "Unable to load matching original template source.";

export function campaignSourceDiagnostics(campaign = {}, template = null) {
  const snapshot = campaign.template_snapshot || {};
  const templateId = String(snapshot.source_template_id || campaign.template_id || "");
  const expectedSourceUpdatedAt = String(snapshot.source_template_updated_at || "");
  const actualTemplateId = String(template?.id || "");
  const actualSourceUpdatedAt = String(template?.updated_at || "");
  return {
    source_used: template ? "original_template_source" : "source_unavailable",
    template_id: templateId,
    actual_template_id: actualTemplateId,
    expected_source_updated_at: expectedSourceUpdatedAt,
    actual_source_updated_at: actualSourceUpdatedAt,
    source_version_match: Boolean(templateId)
      && templateId === actualTemplateId
      && Boolean(expectedSourceUpdatedAt)
      && expectedSourceUpdatedAt === actualSourceUpdatedAt,
  };
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
  const diagnostics = campaignSourceDiagnostics(campaign, template);
  if (!diagnostics.source_version_match) {
    return { campaign: null, refreshed: false, reason: "source_version_mismatch", diagnostics };
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
    diagnostics,
    campaign: {
      ...campaignStructure,
      template_snapshot: templateSnapshot,
      subject_line: restoreRawOverride(campaign.subject_line, templateSnapshot.default_subject, template),
      preview_text: restoreRawOverride(campaign.preview_text, templateSnapshot.preview_text, template),
    },
  };
}
