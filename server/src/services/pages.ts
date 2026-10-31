import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { getSettings, type AppSettings } from './settings.js';
import { humanMinutes, rupiah } from './format.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Nomor HP Indonesia → format wa.me. */
function waNumber(phone: string) {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `62${d.slice(1)}` : d;
}

/** Warna lebih gelap untuk gradasi. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

const baseCss = (brand: string) => `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;min-height:100vh;color:#0f172a;
background:linear-gradient(160deg,${brand} 0%,${shade(brand, -0.35)} 100%);display:flex;align-items:flex-start;justify-content:center;padding:28px 16px}
.wrap{width:100%;max-width:400px}
.brand{color:#fff;text-align:center;margin-bottom:20px}
.logo{width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px}
.brand h1{font-size:22px;font-weight:800;letter-spacing:-.02em}
.brand p{opacity:.85;font-size:14px;margin-top:4px}
.card{background:#fff;border-radius:22px;padding:22px;box-shadow:0 20px 50px rgba(15,23,42,.25)}
.card+.card{margin-top:14px}
h2{font-size:18px;font-weight:800}
.muted{color:#64748b;font-size:14px;margin-top:4px;line-height:1.5}
label{display:block;font-size:13px;font-weight:700;margin:16px 0 6px}
input{width:100%;height:52px;border:1.5px solid #e2e8f0;border-radius:14px;padding:0 16px;font-size:20px;font-weight:700;letter-spacing:.12em;
text-transform:uppercase;outline:none;font-family:ui-monospace,Menlo,monospace}
input:focus{border-color:${brand};box-shadow:0 0 0 4px ${brand}26}
input::placeholder{letter-spacing:normal;text-transform:none;font-family:inherit;font-weight:500;font-size:16px;color:#94a3b8}
svg{flex-shrink:0}
input.pw{text-transform:none;letter-spacing:normal;font-size:17px;font-family:inherit;font-weight:600}
.btn{display:flex;width:100%;height:52px;border:0;border-radius:14px;background:${brand};color:#fff;font-size:16px;font-weight:800;
align-items:center;justify-content:center;gap:8px;margin-top:16px;cursor:pointer;text-decoration:none}
.btn.wa{background:#22c55e}
.btn.ghost{background:#f1f5f9;color:#0f172a}
.err{background:#fef2f2;color:#b91c1c;border-radius:12px;padding:10px 12px;font-size:14px;margin-top:14px}
.price{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid #f1f5f9}
.price:first-of-type{border-top:0}
.price b{font-size:15px}
.price span{display:block;color:#64748b;font-size:12px;margin-top:2px}
.price strong{color:${brand};font-size:16px}
.foot{color:rgba(255,255,255,.75);text-align:center;font-size:12px;margin-top:18px}
.box{background:#f8fafc;border-radius:14px;padding:14px;font-size:14px;white-space:pre-line;line-height:1.55;margin-top:14px}
.amount{font-size:32px;font-weight:800;color:#dc2626;margin-top:6px}
`;

const wifiIcon = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="#fff"/></svg>`;
const waIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9s-.5-.1-.7.1-.8.9-.9 1.1-.3.2-.6.1a8 8 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1 2.5 5.9 5.9 0 0 0 1.2 3.1 13.5 13.5 0 0 0 5.2 4.6c1.9.8 2.7.9 3.6.7a3.1 3.1 0 0 0 2-1.4 2.5 2.5 0 0 0 .2-1.4c-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/></svg>`;

/**
 * Halaman login hotspot MikroTik. Memakai variabel bawaan hotspot ($(link-login-only), $(chap-id), …).
 * CHAP memakai md5.js bawaan router bila tersedia; jika tidak, kirim biasa (PAP).
 */
export function renderLoginHtml(s: AppSettings = getSettings()): string {
  const pkgs = s.loginShowPrices
    ? db.select().from(schema.packages).where(eq(schema.packages.active, true)).orderBy(asc(schema.packages.price)).all()
    : [];
  const brand = s.brandColor || '#4f46e5';
  const single = s.passwordSameAsCode;
  const prices = pkgs.map((p) => {
    const info = [p.uptimeLimitMin && `Pemakaian ${humanMinutes(p.uptimeLimitMin)}`, p.validityMin && `berlaku ${humanMinutes(p.validityMin)}`]
      .filter(Boolean).join(', ') || 'Tanpa batas waktu';
    return `<div class="price"><div><b>${esc(p.name)}</b><span>${esc(info)}</span></div><strong>${esc(rupiah(p.price))}</strong></div>`;
  }).join('');
  const wa = s.phone ? `<a class="btn wa" href="https://wa.me/${waNumber(s.phone)}?text=${encodeURIComponent(`Halo ${s.businessName}, saya mau beli voucher WiFi`)}">${waIcon} Beli voucher via WhatsApp</a>` : '';

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="-1">
<title>${esc(s.businessName)} — Login WiFi</title>
<style>${baseCss(brand)}</style>
<script src="/md5.js"></script>
</head><body><div class="wrap">
<div class="brand"><div class="logo">${wifiIcon}</div><h1>${esc(s.businessName)}</h1><p>${esc(s.loginTitle)}</p></div>
<div class="card">
<h2>Masuk ke internet</h2><p class="muted">${esc(s.loginWelcome)}</p>
$(if error)<div class="err">$(error)</div>$(endif)
<form name="login" action="$(link-login-only)" method="post" onsubmit="return doLogin()">
<input type="hidden" name="dst" value="$(link-orig)"><input type="hidden" name="popup" value="true">
<label for="u">${single ? 'Kode voucher' : 'Username'}</label>
<input id="u" name="username" value="$(username)" autocomplete="off" autocapitalize="characters" placeholder="${single ? 'Ketik kode voucher' : 'Username'}" required>
${single
    ? '<input type="hidden" name="password">'
    : '<label for="p">Password</label><input id="p" class="pw" name="password" type="password" placeholder="Password" required>'}
<button class="btn" type="submit">Masuk</button>
</form>
${wa}
</div>
${prices ? `<div class="card"><h2>Daftar harga voucher</h2><div style="margin-top:8px">${prices}</div></div>` : ''}
<p class="foot">${esc(s.address || s.voucherFooter)}</p>
</div>
<form name="sendin" action="$(link-login-only)" method="post" style="display:none">
<input type="hidden" name="username"><input type="hidden" name="password"><input type="hidden" name="dst" value="$(link-orig)"><input type="hidden" name="popup" value="true">
</form>
<script>
function doLogin(){
  var f=document.login,u=f.username.value.trim()${single ? '.toUpperCase()' : ''};
  var p=${single ? 'u' : 'f.password.value'};
  $(if chap-id)
  if(window.hexMD5){document.sendin.username.value=u;document.sendin.password.value=hexMD5('$(chap-id)'+p+'$(chap-challenge)');document.sendin.submit();return false;}
  $(endif)
  f.username.value=u;f.password.value=p;return true;
}
document.getElementById('u').focus();
</script>
</body></html>`;
}

/** Ganti variabel MikroTik dengan contoh agar bisa dipreview di browser. */
export function previewMikrotik(html: string): string {
  return html
    .replace(/\$\(if [^)]+\)[\s\S]*?\$\(endif\)/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/\$\([^)]+\)/g, '')
    .replace(/onsubmit="return doLogin\(\)"/, 'onsubmit="return false"');
}

export interface IsolirInfo { name: string; amount: number; periods: string[] }

/** Halaman untuk pelanggan PPPoE yang sedang diisolir. */
export function renderIsolirHtml(info: IsolirInfo | null, s: AppSettings = getSettings()): string {
  const brand = '#dc2626';
  const msg = info
    ? `Halo ${info.name}, tagihan Anda periode ${info.periods.join(', ')} belum dibayar.`
    : 'Ada tagihan internet yang belum dibayar.';
  const wa = s.phone
    ? `<a class="btn wa" href="https://wa.me/${waNumber(s.phone)}?text=${encodeURIComponent(info ? `Halo ${s.businessName}, saya ${info.name} mau membayar tagihan internet sebesar ${rupiah(info.amount)}.` : `Halo ${s.businessName}, saya mau membayar tagihan internet.`)}">${waIcon} Hubungi kami via WhatsApp</a>`
    : '';
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="pragma" content="no-cache"><title>Layanan diisolir — ${esc(s.businessName)}</title>
<style>${baseCss(brand)}</style></head><body><div class="wrap">
<div class="brand"><div class="logo"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
<h1>${esc(s.businessName)}</h1><p>Layanan internet sementara diisolir</p></div>
<div class="card">
<h2>${esc(msg)}</h2>
${info && info.amount ? `<p class="muted">Total yang perlu dibayar</p><div class="amount">${esc(rupiah(info.amount))}</div>` : ''}
<p class="muted" style="margin-top:12px">${esc(s.isolirMessage)}</p>
${s.paymentInfo ? `<div class="box"><b>Cara pembayaran</b>\n${esc(s.paymentInfo)}</div>` : ''}
${wa}
</div>
<p class="foot">Internet aktif otomatis beberapa saat setelah pembayaran dikonfirmasi.</p>
</div></body></html>`;
}
