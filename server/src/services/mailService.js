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
    });
  }
  return transporter;
}

/**
 * Sends an email. Without SMTP settings (local development) the message is printed to the
 * server console instead, so verify/reset links can be copied straight from the terminal.
 * Never throws: a mail problem must not break registration.
 */
export async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`\n--- EMAIL (SMTP not configured) ---\nTo: ${to}\nSubject: ${subject}\n${text}\n-----------------------------------\n`);
    return;
  }
  try {
    await t.sendMail({ from: env.smtp.from, to, subject, text, html });
  } catch (err) {
    console.error('Failed to send email', err.message);
  }
}

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
