// Follow-up email. Composition is transport-agnostic: composeEmail builds the
// real subject + body, and deliver() routes it based on EMAIL_TRANSPORT.
//   - "preview" (default): writes a .eml file to ./outbox (and logs a line) so
//     we can see exactly what would be sent — unchanged local behavior.
//   - "smtp": sends for real via nodemailer using the SMTP_* settings.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
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
  downloadUrl?: string | null; // direct video download (shown alongside watch)
};

export async function sendFollowUpEmail(input: FollowUpEmailInput): Promise<void> {
  const { subject, text, html } = composeEmail(input);
  await deliver(input.founder.email, subject, text, html);
}

// MongoDB for Startups CTA targets (from the event team).
const APPLY_URL =
  'https://www.mongodb.com/lp/solutions/startups/partners?utm_campaign=startups-partners&utm_source=localNYC9.30&utm_medium=event';
const ELIGIBILITY_URL = 'https://www.mongodb.com/solutions/startups';

function composeEmail(input: FollowUpEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const firstName = input.founder.name.trim().split(/\s+/)[0] || 'there';
  const expiry = input.recordingExpiresAt
    ? new Date(input.recordingExpiresAt).toLocaleDateString()
    : null;

  const subject = '.local NYC: Your Roast My Startup recording is here \u{1F525}';

  // Recording link block: the video deliverable gives Watch + Download; the rare
  // audio-only fallback gives a single recording link.
  const linksText = input.watchUrl
    ? [
        `Watch your roast: ${input.watchUrl}`,
        input.downloadUrl ? `Download the video: ${input.downloadUrl}` : null,
        expiry ? `(These links expire ${expiry}.)` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : input.recordingUrl
      ? `Here\u2019s your recording: ${input.recordingUrl}${expiry ? `\n(This link expires ${expiry}.)` : ''}`
      : 'Your recording is still processing; we\u2019ll follow up with the link shortly.';

  const text = [
    `Hi ${firstName},`,
    '',
    'Thank you for stopping by Roast My Startup, powered by MongoDB x Google Cloud x ElevenLabs! We hope your roast wasn\u2019t too spicy \u{1F609}',
    '',
    linksText,
    '',
    'Feel free to share it on social media - just make sure to tag @MongoDB and use #MongoDBlocal',
    '',
    'Since you\u2019re bold enough to survive a live roast, you might be a great fit for the MongoDB for Startups program. Qualified founders can get up to $15,000 in Atlas credits*, technical guidance, and go-to-market support to help you build and scale.',
    '',
    `Apply for up to $15k in credits \u2192 ${APPLY_URL}`,
    '',
    'Happy building,',
    'The MongoDB for Startups Team',
    '',
    `*MongoDB for Startups credits are subject to program eligibility criteria. Check your eligibility here: ${ELIGIBILITY_URL}`,
  ].join('\n');

  const linksHtml = input.watchUrl
    ? `<a href="${input.watchUrl}">Watch your roast</a>` +
      (input.downloadUrl ? ` &middot; <a href="${input.downloadUrl}">Download the video</a>` : '') +
      (expiry
        ? `<br/><span style="color:#555;font-size:13px">These links expire ${escapeHtml(expiry)}.</span>`
        : '')
    : input.recordingUrl
      ? `<a href="${input.recordingUrl}">Here\u2019s your recording</a>${expiry ? `<br/><span style="color:#555;font-size:13px">This link expires ${escapeHtml(expiry)}.</span>` : ''}`
      : 'Your recording is still processing; we\u2019ll follow up with the link shortly.';

  const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px;line-height:1.5;color:#001E2B">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Thank you for stopping by Roast My Startup, powered by MongoDB &times; Google Cloud &times; ElevenLabs! We hope your roast wasn\u2019t too spicy \u{1F609}</p>
  <p>${linksHtml}</p>
  <p>Feel free to share it on social media &mdash; just make sure to tag <strong>@MongoDB</strong> and use <strong>#MongoDBlocal</strong>.</p>
  <p>Since you\u2019re bold enough to survive a live roast, you might be a great fit for the MongoDB for Startups program. Qualified founders can get up to <strong>$15,000 in Atlas credits*</strong>, technical guidance, and go-to-market support to help you build and scale.</p>
  <p><a href="${APPLY_URL}" style="display:inline-block;background:#00ED64;color:#001E2B;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:8px">Apply for up to $15k in credits &rarr;</a></p>
  <p>Happy building,<br/>The MongoDB for Startups Team</p>
  <p style="color:#555;font-size:12px">*MongoDB for Startups credits are subject to program eligibility criteria. <a href="${ELIGIBILITY_URL}">Check your eligibility here</a>.</p>
</div>`;

  return { subject, text, html };
}

let transporter: Transporter | null = null;

// Build (once) the nodemailer SMTP transport from env.
function smtpTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function deliver(to: string, subject: string, text: string, html: string) {
  const transport = (process.env.EMAIL_TRANSPORT || 'preview').toLowerCase();

  if (transport === 'smtp') {
    // Real send. Throws on failure so the caller can retry / queue.
    await smtpTransport().sendMail({
      from: FROM,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      to,
      subject,
      text,
      html,
    });
    console.log(`[email] smtp -> ${to} | ${subject}`);
    return;
  }

  // Preview transport (default). Writes a .eml to ./outbox — unchanged behavior.
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
