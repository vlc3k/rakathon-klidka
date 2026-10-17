// Lékové záznamy od praktika pro demo pacienty: léky podle nemocničního FHIR (IRIS, scripts/data/synthea.json),
// vyrenderované jako A4 (Chrome headless) a „vyfocené telefonem“ (natočení, stín, šum…) do lib/data/demo-docs.
// Doplní je do scripts/data/demo.json k zákroku, nahraje a přečte je pak npm run seed:cases.
// Jména a rodná čísla jsou testovací (Bank iD sandbox), nejde o skutečné pacienty.
//
//   node --no-warnings scripts/med-docs.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = path.join(root, "scripts/data/demo.json");
const OUT_IMG = path.join(root, "lib/data/demo-docs");
const CHROME = process.env.CHROME ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);

// Léky, které pacient podle IRIS teď bere (u Kohlové poslední z roku 2025), česky jako na receptu.
const RECORDS = {
  "case-03": {
    date: "2026-10-09",
    level: 2,
    meds: [{ name: "Tenoretic", strength: "50 mg/12,5 mg", substance: "atenolol, chlortalidon", dose: "1-0-0", since: "1998", fhir: "Atenolol 50 MG / Chlorthalidone 25 MG Oral Tablet" }],
  },
  "case-04": {
    date: "2026-10-02",
    level: 1,
    meds: [
      { name: "Hydrochlorothiazid Léčiva", strength: "12,5 mg", substance: "hydrochlorothiazid", dose: "1-0-0", since: "1989", fhir: "Hydrochlorothiazide 12.5 MG" },
      { name: "Naproxen", strength: "220 mg", substance: "naproxen sodná sůl", dose: "dle potřeby, max. 2× denně", since: "2024", fhir: "Naproxen sodium 220 MG Oral Tablet" },
    ],
  },
  "case-05": {
    date: "2026-10-07",
    level: 3,
    meds: [{ name: "Naproxen", strength: "220 mg", substance: "naproxen sodná sůl", dose: "dle potřeby při bolesti", since: "2025", fhir: "Naproxen sodium 220 MG Oral Tablet" }],
  },
  "case-06": {
    date: "2026-10-12",
    level: 2,
    meds: [
      { name: "Clexane", strength: "4000 IU (40 mg)/0,4 ml", substance: "enoxaparin sodná sůl", dose: "0-0-1 s.c.", since: "2020", fhir: "0.4 ML Enoxaparin sodium 100 MG/ML Prefilled Syringe" },
      { name: "Ventolin inhalátor", strength: "100 µg/dávka", substance: "salbutamol", dose: "1–2 vdechy dle potřeby", since: "2020", fhir: "Albuterol 0.09 MG/ACTUAT Metered Dose Inhaler" },
      { name: "Paralen", strength: "500 mg", substance: "paracetamol", dose: "dle potřeby, max. 4× denně", since: "2020", fhir: "Acetaminophen 500 MG Oral Tablet" },
    ],
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (iso) => iso.split("-").reverse().map(Number).join(". ");

function html(c, r) {
  const rows = r.meds
    .map((m) => `<tr><td><b>${esc(m.name)}</b><div class="s">${esc(m.substance)}</div></td><td>${esc(m.strength)}</td><td>${esc(m.dose)}</td><td class="r">${esc(m.since)}</td></tr>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#fff;font-family:Georgia,"Times New Roman",serif;color:#111}
    .page{width:1000px;height:1414px;box-sizing:border-box;padding:70px 80px;position:relative}
    header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:16px}
    .inst{font-size:26px;font-weight:bold}.sub{font-size:17px}.title{font-size:22px;font-weight:bold;text-align:right}
    .pat{display:grid;grid-template-columns:1fr 1fr;gap:8px 40px;margin:36px 0;font-size:20px}
    table{width:100%;border-collapse:collapse;font-size:20px}th{text-align:left;border-bottom:1px solid #111;padding:6px 0}
    td{border-bottom:1px solid #ccc;padding:9px 0;vertical-align:top}th+th,td+td{padding-left:24px}.r{text-align:right}
    .s{font-size:15px;color:#444}p{font-size:20px}
    footer{position:absolute;left:80px;right:80px;bottom:60px;border-top:1px solid #111;padding-top:6px;font-size:13px;display:flex;justify-content:space-between}
  </style><div class="page"><header><div><div class="inst">MUDr. Petr Zkušební</div><div class="sub">Praktický lékař pro dospělé</div><div class="sub">Zkušební 12, 120 00 Praha 2</div></div><div class="title">SEZNAM UŽÍVANÝCH LÉKŮ</div></header>
  <div class="pat"><div>Pacient: <b>${esc(c.patient_name)}</b></div><div>Rodné číslo: <b>${esc(c.birth_number)}</b></div><div>Pojišťovna: 111</div><div>Vystaveno: ${fmt(r.date)}</div></div>
  <table><thead><tr><th>Lék</th><th>Síla</th><th>Dávkování</th><th class="r">Užívá od</th></tr></thead><tbody>${rows}</tbody></table>
  <p style="margin-top:28px"><b>Alergie:</b> neguje</p>
  <p>Výpis pro anesteziologickou ambulanci k plánovanému výkonu.</p>
  <footer><span>Syntetický demo dokument, nejde o skutečného pacienta.</span><span>MUDr. Petr Zkušební</span></footer></div>`;
}

// ---------- „vyfoceno telefonem“ (stejně jako ostatní demo doklady) ----------
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function photograph(png, level, seed) {
  const r = rng(seed);
  const between = (a, b) => a + (b - a) * r();
  const W = 1000, H = 1414;
  const layers = [
    `<defs><linearGradient id="l" gradientTransform="rotate(${Math.round(between(0, 360))} .5 .5)"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#3a2a1a" stop-opacity="${(between(0.12, 0.2) * level).toFixed(2)}"/></linearGradient>
     <radialGradient id="v"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${(0.08 * level).toFixed(2)}"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="#f3ead6" opacity="${(0.25 + 0.1 * level).toFixed(2)}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#l)"/><rect width="${W}" height="${H}" fill="url(#v)"/>`,
  ];
  if (level >= 2) {
    const fold = Math.round(between(0.45, 0.65) * H);
    layers.push(`<rect y="${fold}" width="${W}" height="3" fill="#000" opacity=".12"/><rect y="${fold + 3}" width="${W}" height="6" fill="#fff" opacity=".35"/>`);
    const cx = between(150, 850), cy = between(700, 1300);
    layers.push(`<ellipse cx="${cx}" cy="${cy}" rx="${between(70, 120)}" ry="${between(60, 100)}" fill="none" stroke="#7a4a1c" stroke-width="${between(8, 16)}" opacity=".18"/>`);
  }
  if (level >= 3) {
    const side = r() < 0.5 ? 0 : W * 0.55;
    layers.unshift(`<defs><filter id="b"><feGaussianBlur stdDeviation="40"/></filter></defs>`);
    layers.push(`<rect x="${side}" y="${between(500, 800)}" width="${W * 0.45}" height="${H}" fill="#1a1208" opacity=".28" filter="url(#b)"/>`);
    layers.push(`<text x="${between(80, 400)}" y="${between(1150, 1300)}" font-family="'Segoe Script','Comic Sans MS',cursive" font-size="34" fill="#1c2f8a" opacity=".85" transform="rotate(-4)">vysadit 7 dní před op.?</text>`);
  }
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${layers.join("")}</svg>`);
  const noise = Buffer.alloc(W * H * 4);
  const amount = 10 + 12 * level;
  for (let i = 0; i < W * H; i++) {
    const v = 128 + (r() - 0.5) * 2 * amount;
    noise[i * 4] = noise[i * 4 + 1] = noise[i * 4 + 2] = v;
    noise[i * 4 + 3] = 255;
  }
  let paper = sharp(png).resize(W, H).composite([
    { input: overlay, blend: "multiply" },
    { input: noise, raw: { width: W, height: H, channels: 4 }, blend: "overlay" },
  ]);
  if (level >= 3) paper = paper.linear(0.72, 38);
  if (level >= 2) paper = paper.blur(between(0.6, 0.9) * (level - 1));
  const sheet = await paper.png().toBuffer();
  const angle = between(1.5, 3) * level * (r() < 0.5 ? -1 : 1);
  const desk = { r: Math.round(between(60, 110)), g: Math.round(between(50, 90)), b: Math.round(between(40, 70)), alpha: 1 };
  let photo = sharp(sheet).extend({ top: 60, bottom: 60, left: 60, right: 60, background: desk }).rotate(angle, { background: desk });
  if (level >= 3) photo = photo.affine([[1, between(-0.06, 0.06)], [between(-0.03, 0.03), 1]], { background: desk });
  return photo.resize({ width: Math.round(1000 - 220 * (level - 1)) }).jpeg({ quality: [82, 62, 42][level - 1] }).toBuffer();
}

const demo = JSON.parse(readFileSync(DEMO, "utf8"));
const tmp = mkdtempSync(path.join(tmpdir(), "med-docs-"));
for (const [caseId, record] of Object.entries(RECORDS)) {
  const c = demo.cases.find((x) => x.case_id === caseId);
  const file = `d-${caseId}-m`;
  const htmlPath = path.join(tmp, `${file}.html`);
  const pngPath = path.join(tmp, `${file}.png`);
  writeFileSync(htmlPath, html(c, record));
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1000,1414", `--screenshot=${pngPath}`, pathToFileURL(htmlPath).href], { stdio: "ignore" });
  writeFileSync(path.join(OUT_IMG, `${file}.jpg`), await photograph(readFileSync(pngPath), record.level, caseId.charCodeAt(5) * 7919));

  if (!c.documents.includes(`${file}.jpg`)) c.documents.push(`${file}.jpg`);
  const entry = {
    file: `${file}.jpg`,
    case_id: caseId,
    _printed: { name: c.patient_name, rc: c.birth_number },
    _truth: { kind: "meds", date: record.date, meds: record.meds },
    _level: record.level,
    document: { type: "medication_list", date: record.date },
  };
  demo.documents = demo.documents.filter((d) => d.file !== entry.file).concat(entry);
  console.log(`${c.patient_name}: ${file}.jpg (${record.meds.map((m) => m.name).join(", ")})`);
}
writeFileSync(DEMO, JSON.stringify(demo, null, 2) + "\n");
