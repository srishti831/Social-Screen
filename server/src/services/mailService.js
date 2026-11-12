import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

// ---------- SMTP (local dev / fallback) ----------
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

// ---------- Gmail API (HTTPS, OAuth2 refresh token) ----------
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

/** Plain-text + HTML MIME message, UTF-8 safe. */
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
 * Priority: 1) Gmail API (if MAIL_GOOGLE_* set)  2) SMTP  3) print to console (local dev).
 * Never throws: a mail problem must not break registration.
 */
export async function sendMail({ to, subject, text, html }) {
  try {
    const g = env.gmail;
    if (g && g.clientId && g.clientSecret && g.refreshToken && g.sender) {
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

// ---------- Email templates ----------
const button = (url, label) =>
  `<p><a href="${url}" style="background:#0b8fa3;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p><p>Or paste this link into your browser:<br>${url}</p>`;

export const sendVerificationEmail = (user, token) => {
  const url = `${env.clientUrl}/verify-email?token=${token}`;
  return sendMail({
    to: user.email,
    subject: 'Verify your email - Social - Screen',
    text: `Hi ${user.name}, verify your email by opening this link (valid for 24 hours): ${url}`,
    html: `<p>Hi ${user.name},</p><p>Please verify your email (link valid for 24 hours).</p>${button(url, 'Verify email')}`,
  });
};

export const sendPasswordResetEmail = (user, token) => {
  const url = `${env.clientUrl}/reset-password?token=${token}`;
  return sendMail({
    to: user.email,
    subject: 'Reset your password - Social - Screen',
    text: `Hi ${user.name}, reset your password with this link (valid for 1 hour): ${url}. If you did not ask for this, ignore this email.`,
    html: `<p>Hi ${user.name},</p><p>Reset your password (link valid for 1 hour). If you did not ask for this, ignore this email.</p>${button(url, 'Reset password')}`,
  });
};