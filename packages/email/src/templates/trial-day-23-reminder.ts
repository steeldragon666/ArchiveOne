/**
 * Trial day-23 reminder email (P9.1.6).
 *
 * Sent to the firm administrator 7 days before their 30-day trial ends
 * (i.e., on day 23 of the trial). Encourages conversion before the
 * trial_ends_at deadline.
 *
 * HTML + plain-text variants for maximum deliverability.
 */

export interface TrialDay23ReminderData {
  /** Recipient's display name. */
  name: string;
  /** Firm/tenant name. */
  firmName: string;
  /** Number of days remaining in the trial (typically 7). */
  daysRemaining: number;
  /** URL to the billing upgrade / Stripe Checkout page. */
  upgradeUrl: string;
}

const BRAND_COLOR = '#5C7A6B'; // patina green per design system
const BG_COLOR = '#FAF8F3'; // warm cream paper base per design system

export function trialDay23ReminderEmail(data: TrialDay23ReminderData): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, firmName, daysRemaining, upgradeUrl } = data;
  const safeName = escapeHtml(name);
  const safeFirmName = escapeHtml(firmName);
  const safeUpgradeUrl = escapeHtml(upgradeUrl);

  const subject = `Your trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} — upgrade now to keep your data`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG_COLOR};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <tr>
      <td style="padding-bottom:24px;border-bottom:2px solid ${BRAND_COLOR};">
        <h1 style="margin:0;font-size:24px;color:${BRAND_COLOR};font-family:Georgia,'Times New Roman',serif;">
          CPA Platform
        </h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 0;">
        <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">
          Hi ${safeName}, your trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}
        </h2>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#333;">
          Your free trial for <strong>${safeFirmName}</strong> on CPA Platform
          will expire in <strong>${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong>.
        </p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#333;">
          Upgrade now to keep your R&amp;D activities, claims, and team access — all your
          data stays exactly where it is.
        </p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#333;">
          Pricing: $5,000 AUD onboarding fee + metered usage per claim (AU GST applies via Stripe Tax).
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="border-radius:6px;background:${BRAND_COLOR};">
              <a href="${safeUpgradeUrl}"
                 style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">
                Upgrade to Paid
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:14px;color:#666;">
          Questions? Reply to this email or contact us at
          <a href="mailto:support@cpaplatform.com.au" style="color:${BRAND_COLOR};">support@cpaplatform.com.au</a>.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding-top:24px;border-top:1px solid #e5e5e5;">
        <p style="margin:0;font-size:12px;color:#999;line-height:1.5;">
          CPA Platform &mdash; Australian R&amp;D Tax Incentive consulting tool.<br />
          You received this because your trial is ending soon.<br />
          If you no longer want these reminders, reply with "unsubscribe".
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Hi ${name},

Your trial for "${firmName}" on CPA Platform ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.

Upgrade now to keep your R&D activities, claims, and team access — all your data stays exactly where it is.

Pricing: $5,000 AUD onboarding fee + metered usage per claim (AU GST applies).

Upgrade here: ${upgradeUrl}

---
CPA Platform - Australian R&D Tax Incentive consulting tool.
Questions? Contact us at support@cpaplatform.com.au`;

  return { subject, html, text };
}

/** Escape HTML special characters to prevent XSS in email templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
