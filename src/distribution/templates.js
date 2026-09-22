/**
 * Human-authored message templates. docs/PROJECT_HANDOFF.md: "Support
 * English and Pijin through human-approved templates — don't
 * machine-translate emergency instructions."
 *
 * IMPORTANT: the Pijin ("pis" — ISO 639-3 for Solomon Islands Pijin,
 * distinct from PNG Tok Pisin "tpi") text below is illustrative only, not
 * an NDMO/SIMS-approved translation. It exists to exercise the
 * localization mechanism (a real human-authored alternative string keyed
 * by language, not a derived/machine-translated one) — it must be replaced
 * with an actual reviewed and approved translation from a qualified
 * Solomon Islands Pijin speaker before this is used operationally. Treat
 * it the same as a placeholder, not as content ready to send.
 *
 * Each template is deliberately short prose with a small, fixed set of
 * variables — templates aren't meant to embed arbitrarily long operator
 * text (that risks silently blowing the segment budget; see
 * messageConstruction.js).
 */

export const TEMPLATES = {
  "hazard-warning": {
    en: "{{hazardType}} WARNING: {{severity}} conditions expected near {{province}} {{time}}. {{instruction}} Info: {{infoLink}}",
    // Illustrative, unapproved — see module comment.
    pis: "WARNING blong {{hazardType}}: {{severity}} kondisen bae kamap klosap long {{province}} {{time}}. {{instruction}} Info: {{infoLink}}",
  },
};

/**
 * @param {string} templateId
 * @param {"en"|"pis"} language
 * @param {Record<string, string>} variables
 * @returns {string}
 */
export function renderTemplate(templateId, language, variables) {
  const templateSet = TEMPLATES[templateId];
  if (!templateSet) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  const template = templateSet[language];
  if (!template) {
    throw new Error(`Template "${templateId}" has no "${language}" version`);
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in variables)) {
      throw new Error(`Template "${templateId}" is missing variable "${key}"`);
    }
    return variables[key];
  });
}
