import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { getSettings } from './settings.js';
import { humanMinutes, rupiah } from './format.js';

export interface PrintVoucher {
  code: string;
  password: string;
  price: number;
  packageName: string;
  validityMin: number | null;
  uptimeLimitMin: number | null;
  quotaMb: number | null;
  color: string;
  dnsName: string | null;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 18;
const GAP = 6;

function usageLine(v: PrintVoucher): string {
  const parts: string[] = [];
  if (v.validityMin) parts.push(`Berlaku ${humanMinutes(v.validityMin)}`);
  if (v.uptimeLimitMin) parts.push(`Pemakaian ${humanMinutes(v.uptimeLimitMin)}`);
  if (v.quotaMb) parts.push(`Kuota ${v.quotaMb >= 1024 ? `${(v.quotaMb / 1024).toFixed(1).replace('.0', '')} GB` : `${v.quotaMb} MB`}`);
  return parts.join(' • ') || 'Tanpa batas waktu';
}

/** Membuat PDF berisi kartu-kartu voucher dalam grid A4, siap cetak & potong. */
export async function renderVouchersPdf(list: PrintVoucher[]): Promise<Buffer> {
  const s = getSettings();
  const cols = Math.min(Math.max(s.printColumns, 2), 6);
  const cardW = (A4.w - MARGIN * 2 - GAP * (cols - 1)) / cols;
  const cardH = Math.max(cardW * 0.6, 82);
  const rows = Math.floor((A4.h - MARGIN * 2 + GAP) / (cardH + GAP));
  const perPage = rows * cols;
  const scale = cardW / 135; // ukuran font menyesuaikan lebar kartu

  const qrs = await Promise.all(list.map((v) => {
    const host = v.dnsName || 'login.wifi';
    const url = `http://${host}/login?username=${encodeURIComponent(v.code)}&password=${encodeURIComponent(v.password)}`;
    return QRCode.toBuffer(url, { margin: 0, width: 160, errorCorrectionLevel: 'M' });
  }));

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Voucher ${s.businessName}`, Creator: 'Wifinate' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  list.forEach((v, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const idx = i % perPage;
    const x = MARGIN + (idx % cols) * (cardW + GAP);
    const y = MARGIN + Math.floor(idx / cols) * (cardH + GAP);
    const color = v.color || s.brandColor;
    const pad = 6 * scale;
    const band = 17 * scale;

    // Bingkai kartu (garis putus-putus sebagai panduan potong)
    doc.save().roundedRect(x, y, cardW, cardH, 6).lineWidth(0.6).dash(2, { space: 2 }).strokeColor('#cbd5e1').stroke().restore();

    // Pita atas: nama usaha & harga
    doc.save().roundedRect(x, y, cardW, band + 6, 6).clip().rect(x, y, cardW, band).fill(color).restore();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5 * scale)
      .text(s.businessName, x + pad, y + band / 2 - 4 * scale, { width: cardW * 0.6, height: 10 * scale, ellipsis: true, lineBreak: false });
    doc.fontSize(8.5 * scale)
      .text(rupiah(v.price), x + pad, y + band / 2 - 4.5 * scale, { width: cardW - pad * 2, align: 'right', lineBreak: false });

    const qrSize = cardH - band - pad * 2 - 2;
    const textW = cardW - qrSize - pad * 3;
    let ty = y + band + pad - 1;

    doc.fillColor('#64748b').font('Helvetica').fontSize(6.5 * scale)
      .text(v.packageName.toUpperCase(), x + pad, ty, { width: textW, lineBreak: false, ellipsis: true });
    ty += 9 * scale;

    doc.fillColor('#64748b').fontSize(5.5 * scale).text(s.passwordSameAsCode ? 'KODE VOUCHER' : 'USERNAME', x + pad, ty, { lineBreak: false });
    ty += 6.5 * scale;
    doc.fillColor('#0f172a').font('Courier-Bold').fontSize(Math.min(14 * scale, (textW / v.code.length) * 1.6))
      .text(v.code, x + pad, ty, { width: textW, lineBreak: false });
    ty += 15 * scale;

    if (!s.passwordSameAsCode) {
      doc.fillColor('#64748b').font('Helvetica').fontSize(5.5 * scale).text('PASSWORD', x + pad, ty, { lineBreak: false });
      doc.fillColor('#0f172a').font('Courier-Bold').fontSize(8.5 * scale).text(v.password, x + pad + 30 * scale, ty - 1.5 * scale, { lineBreak: false });
      ty += 10 * scale;
    }

    doc.fillColor('#334155').font('Helvetica').fontSize(5.5 * scale)
      .text(usageLine(v), x + pad, ty, { width: textW, height: 14 * scale, ellipsis: true });

    const footer = [s.voucherFooter, s.phone && `WA ${s.phone}`].filter(Boolean).join(' • ');
    doc.fillColor('#94a3b8').fontSize(5 * scale)
      .text(footer, x + pad, y + cardH - pad - 5 * scale, { width: textW, lineBreak: false, ellipsis: true });

    doc.image(qrs[i], x + cardW - qrSize - pad, y + band + pad, { width: qrSize, height: qrSize });
  });

  if (!list.length) doc.font('Helvetica').fontSize(12).text('Tidak ada voucher untuk dicetak.', 40, 40);
  doc.end();
  return done;
}
