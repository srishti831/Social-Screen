import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;
function getTransporter() {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

// ---- Gmail API (HTTPS, OAuth2 refresh token) ----
let gmailToken = { value: null, expiresAt: 0 };

async function getGmailAccessToken() {
  if (gmailToken.value && Date.now() < gmailToken.expiresAt) return gmailToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.gmail.clientId,
      client_secret: env.gmail.clientSecret,
      refresh_token: env.gmail.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  gmailToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 };
  return gmailToken.value;
}

/** Plain-text + HTML wala MIME message, UTF-8 safe. */
function buildMime({ to, subject, text, html }) {
  const boundary = `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const b64 = (s) => Buffer.from(s || '', 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `From: "${env.gmail.senderName}" <${env.gmail.sender}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function sendViaGmail({ to, subject, text, html }) {
  const token = await getGmailAccessToken();
  const raw = Buffer.from(buildMime({ to, subject, text, html })).toString('base64url');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
}

/**
 * Priority: 1) Gmail API  2) SMTP  3) console par print (local dev).
 * Never throws: mail ki problem se registration nahi tootna chahiye.
 */
export async function sendMail({ to, subject, text, html }) {
  try {
    const g = env.gmail;
    if (g.clientId && g.clientSecret && g.refreshToken && g.sender) {
      await sendViaGmail({ to, subject, text, html });
      return;
    }
    const t = getTransporter();
    if (!t) {
      console.log(`\n--- EMAIL (not configured) ---\nTo: ${to}\nSubject: ${subject}\n${text}\n------------------------------\n`);
      return;
    }
    await t.sendMail({ from: env.smtp.from, to, subject, text, html });
  } catch (err) {
    console.error('Failed to send email:', err.message);
  }
}