import fs from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const files = [
  '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB/COLRUYT OCTOBRE 2025 400,28€.pdf',
  '/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB/COMARCHE - JANV 2026 - 81.07 €.pdf'
];
for (const f of files) {
  try {
    const buf = fs.readFileSync(f);
    const data = await pdfParse(buf);
    console.log('\n=== FILE ===\n' + f);
    const txt = String(data.text || '').replace(/\r/g, '');
    const lines = txt.split('\n').map(x=>x.trim()).filter(Boolean);
    console.log('pages?', data.numpages, 'lines', lines.length);
    console.log(lines.slice(0, 120).join('\n'));
  } catch (e) {
    console.log('\n=== FILE ===\n' + f);
    console.log('ERR', e.message);
  }
}
