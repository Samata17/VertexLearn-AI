import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Email transport. Locally this points at Mailpit (a fake inbox at http://localhost:8025),
 * so no real emails are sent. In production, set SMTP_* to a real provider (SES, SendGrid, ...).
 */
export const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f3ff;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1e1b4b">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e9e5ff">
    <div style="font-weight:700;font-size:18px;color:#6d28d9;margin-bottom:24px">VertexLearn AI</div>
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <div style="font-size:15px;line-height:1.6;color:#334155">${bodyHtml}</div>
    ${
      cta
        ? `<a href="${cta.url}" style="display:inline-block;margin-top:24px;background:#6d28d9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${cta.label}</a>`
        : ''
    }
    <p style="font-size:12px;color:#94a3b8;margin-top:32px">Vertexon Learning Technologies Pvt. Ltd.</p>
  </div></body></html>`;
}
