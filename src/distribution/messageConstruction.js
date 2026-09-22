import { renderTemplate } from "./templates.js";
import { detectEncoding, computeSegments } from "./encoding.js";

/**
 * docs/PROJECT_HANDOFF.md: "Message construction needs its own subsystem
 * ... template -> localization -> encoding detection -> segment count ->
 * preview -> approval, rejecting anything that unexpectedly crosses a
 * segment boundary."
 *
 * REJECTED_SEGMENT_BUDGET is a hard stop, not a warning a human can wave
 * through — the doc's example of a single Unicode character silently
 * doubling the per-segment cost is exactly the kind of mistake this exists
 * to catch mechanically. PENDING_APPROVAL/APPROVED is a minimal gate:
 * approveMessage() exists so NotificationService can require it before
 * sending, but this deliberately does not model *who* may approve or check
 * any role — that's the RBAC/approval-workflow layer, out of scope here.
 */
export const ConstructionStatus = Object.freeze({
  REJECTED_SEGMENT_BUDGET: "REJECTED_SEGMENT_BUDGET",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
});

/**
 * @typedef {Object} ConstructedMessage
 * @property {string} templateId
 * @property {"en"|"pis"} language
 * @property {string} text                  The rendered preview text
 * @property {string} encoding              One of Encoding's values
 * @property {number} characterCount
 * @property {number} segments
 * @property {number} maxSegments           The budget this was checked against
 * @property {string} status                One of ConstructionStatus
 */

/**
 * Runs template -> localization -> encoding detection -> segment count,
 * and produces the preview a human (or a future approval workflow) would
 * review. Never throws for a message that's merely too long — that's a
 * REJECTED_SEGMENT_BUDGET result the caller can inspect, not an exception,
 * since "the template produced a too-long message" is an expected
 * operational outcome, not a programming error. Missing template
 * variables and unknown template ids still throw (see templates.js) — those
 * are programming errors, not content problems.
 *
 * @param {{ templateId: string, language: "en"|"pis", variables: Record<string,string>, maxSegments?: number }} params
 * @returns {Readonly<ConstructedMessage>}
 */
export function buildMessage({ templateId, language, variables, maxSegments = 1 }) {
  const text = renderTemplate(templateId, language, variables);
  const encoding = detectEncoding(text);
  const { characterCount, segments } = computeSegments(text, encoding);

  const status = segments > maxSegments ? ConstructionStatus.REJECTED_SEGMENT_BUDGET : ConstructionStatus.PENDING_APPROVAL;

  return Object.freeze({
    templateId,
    language,
    text,
    encoding,
    characterCount,
    segments,
    maxSegments,
    status,
  });
}

/**
 * The approval gate. Only a PENDING_APPROVAL message can be approved — a
 * REJECTED_SEGMENT_BUDGET message must go back through buildMessage() with
 * different variables/template/budget, not be force-approved.
 *
 * @param {Readonly<ConstructedMessage>} constructed
 * @returns {Readonly<ConstructedMessage>}
 */
export function approveMessage(constructed) {
  if (constructed.status !== ConstructionStatus.PENDING_APPROVAL) {
    throw new Error(`Cannot approve a message in status ${constructed.status}`);
  }
  return Object.freeze({ ...constructed, status: ConstructionStatus.APPROVED });
}
