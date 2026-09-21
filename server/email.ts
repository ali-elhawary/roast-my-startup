// Follow-up email. Preview transport for now: it composes the real subject and
// body and writes a .eml file to ./outbox (and logs a line) so we can see
// exactly what would be sent. Swap `deliver` for SMTP / Resend / SendGrid later
// without touching the composition.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Founder, Roast } from '../shared/types';

const OUTBOX_DIR = path.resolve(process.cwd(), 'outbox');
const FROM = process.env.EMAIL_FROM || 'Roast My Startup <booth@roast-my-startup.local>';

export type FollowUpEmailInput = {
  founder: Founder;
  sessionId: string;
  roast: Roast | null;
  recordingUrl: string | null;
  recordingExpiresAt: number | null;
  watchUrl?: string | null; // video watch page (takes precedence over audio link)
};

export async function sendFollowUpEmail(input: FollowUpEmailInput): Promise<void> {
  const { subject, text, html } = composeEmail(input);
  await deliver(input.founder.email, subject, text, html);
}

function composeEmail(input: FollowUpEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const firstName = input.founder.name.trim().split(/\s+/)[0] || 'there';
  const roastText = input.roast?.text?.trim();
  const expiry = input.recordingExpiresAt
    ? new Date(input.recordingExpiresAt).toLocaleDateString()
    : null;

  const subject = input.watchUrl
    ? 'Your Roast My Startup video'
    : 'Your Roast My Startup recording';

  // TODO: replace with the real MongoDB for Startups program copy (MongoDB owns
  // this content).
  const startupsBlurb =
    'MongoDB for Startups gives eligible startups free Atlas credits, technical ' +
    'guidance, and co-marketing. Details: [TODO: real link].';

  const recordingLine = input.watchUrl
    ? `Watch your roast here: ${input.watchUrl}${expiry ? `\n(This link expires ${expiry}.)` : ''}`
    : input.recordingUrl
      ? `Listen back here: ${input.recordingUrl}${expiry ? `\n(This link expires ${expiry}.)` : ''}`
      : 'Your recording is still processing; we\u2019ll follow up with the link shortly.';

  const roastBlock = roastText
    ? `Here\u2019s the roast, in case you want it in writing:\n\n"${roastText}"`
    : 'Thanks for stepping into the hot seat.';

  const text = [
    `Hi ${firstName},`,
    '',
    'Thanks for getting roasted at the booth.',
    '',
    roastBlock,
    '',
    recordingLine,
    '',
    startupsBlurb,
    '',
    '\u2014 The Roast My Startup booth',
  ].join('\n');

  const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Thanks for getting roasted at the booth.</p>
  ${roastText ? `<blockquote style="border-left:3px solid #39FF6A;margin:0;padding:8px 16px;color:#111">${escapeHtml(roastText)}</blockquote>` : ''}
  <p>${
    input.watchUrl
      ? `<a href="${input.watchUrl}">Watch your roast</a>${expiry ? ` &middot; expires ${escapeHtml(expiry)}` : ''}`
      : input.recordingUrl
        ? `<a href="${input.recordingUrl}">Listen back to your recording</a>${expiry ? ` &middot; expires ${escapeHtml(expiry)}` : ''}`
        : 'Your recording is still processing; we\u2019ll follow up with the link shortly.'
  }</p>
  <hr/>
  <p style="color:#555">${escapeHtml(startupsBlurb)}</p>
  <p>&mdash; The Roast My Startup booth</p>
</div>`;

  return { subject, text, html };
}

async function deliver(to: string, subject: string, text: string, html: string) {
  // Preview transport. Replace the body of this function with a real provider.
  console.log(`[email] preview -> ${to} | ${subject}`);
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTo = to.replace(/[^a-z0-9@._-]/gi, '_');
  const eml =
    `From: ${FROM}\n` +
    `To: ${to}\n` +
    `Subject: ${subject}\n` +
    `Content-Type: text/html; charset=utf-8\n\n` +
    html +
    `\n\n---- text/plain ----\n${text}\n`;
  await fs.writeFile(path.join(OUTBOX_DIR, `${stamp}_${safeTo}.eml`), eml);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
