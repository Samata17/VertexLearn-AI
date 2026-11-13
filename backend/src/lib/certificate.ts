/**
 * Certificate PDF generation with pdf-lib (PRD 13: "Puppeteer / pdf-lib").
 * pdf-lib draws the PDF directly in Node — no headless browser needed, so it's fast and light.
 */
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { one } from '../db/pool.js';
import { env } from '../config/env.js';
import { putObject } from './storage.js';

const navy = rgb(0.118, 0.106, 0.294);
const purple = rgb(0.427, 0.157, 0.851);
const lavender = rgb(0.961, 0.953, 1);
const slate = rgb(0.392, 0.455, 0.545);

export async function renderCertificatePdf(data: {
  studentName: string;
  courseTitle: string;
  instructorName: string;
  issuedAt: Date;
  code: string;
}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate — ${data.courseTitle}`);
  pdf.setAuthor('VertexLearn AI');
  const page = pdf.addPage([842, 595]); // A4 landscape
  const { width, height } = page.getSize();
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: lavender });
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: purple, borderWidth: 2, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: rgb(0.85, 0.82, 0.98), borderWidth: 1 });
  page.drawRectangle({ x: 24, y: height - 32, width: width - 48, height: 8, color: purple });

  const center = (text: string, y: number, size: number, font = sans, color = navy) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font, color });
  };
  const fit = (text: string, max: number, font: typeof sans, start: number) => {
    let size = start;
    while (size > 14 && font.widthOfTextAtSize(text, size) > max) size -= 1;
    return size;
  };

  center('VERTEXLEARN AI', height - 90, 14, sansBold, purple);
  center('Certificate of Completion', height - 150, 40, serif, navy);
  center('This certifies that', height - 200, 14, sans, slate);
  center(data.studentName, height - 255, fit(data.studentName, width - 160, serif, 36), serif, navy);
  page.drawLine({ start: { x: width / 2 - 180, y: height - 268 }, end: { x: width / 2 + 180, y: height - 268 }, color: purple, thickness: 1 });
  center('has successfully completed the course', height - 300, 14, sans, slate);
  center(data.courseTitle, height - 340, fit(data.courseTitle, width - 160, sansBold, 24), sansBold, navy);

  const date = data.issuedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  page.drawText(date, { x: 120, y: 120, size: 13, font: sansBold, color: navy });
  page.drawLine({ start: { x: 110, y: 112 }, end: { x: 310, y: 112 }, color: slate, thickness: 0.5 });
  page.drawText('Date issued', { x: 120, y: 96, size: 10, font: sans, color: slate });

  page.drawText(data.instructorName, { x: width - 310, y: 120, size: 13, font: sansBold, color: navy });
  page.drawLine({ start: { x: width - 320, y: 112 }, end: { x: width - 110, y: 112 }, color: slate, thickness: 0.5 });
  page.drawText('Instructor', { x: width - 310, y: 96, size: 10, font: sans, color: slate });

  center(`Certificate ID: ${data.code}`, 70, 9, sans, slate);
  center(`Verify at ${env.APP_URL}/verify/${data.code}`, 56, 9, sans, slate);
  return Buffer.from(await pdf.save());
}

/** Creates (or returns) the certificate record, generating and storing the PDF. Idempotent. */
export async function issueCertificate(userId: string, courseId: string) {
  const existing = await one('SELECT * FROM certificates WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
  if (existing?.certificate_url) return existing;
  const info = await one(
    `SELECT u.full_name AS student, c.title, i.full_name AS instructor, e.completed_at
     FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id JOIN users i ON i.id = c.instructor_id
     WHERE e.user_id = $1 AND e.course_id = $2`,
    [userId, courseId],
  );
  if (!info?.completed_at) throw new Error('Course not completed');
  const code = existing?.certificate_code ?? `VL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const issuedAt = existing?.issued_at ? new Date(existing.issued_at) : new Date();
  const pdf = await renderCertificatePdf({ studentName: info.student, courseTitle: info.title, instructorName: info.instructor, issuedAt, code });
  const key = await putObject('certificates', `${code}.pdf`, pdf, 'application/pdf');
  return one(
    `INSERT INTO certificates (user_id, course_id, certificate_url, certificate_code, issued_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, course_id) DO UPDATE SET certificate_url = $3 RETURNING *`,
    [userId, courseId, key, code, issuedAt],
  );
}
