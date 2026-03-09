import fs from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
const f='/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB/COMARCHE - JANV 2026 - 81.07 €.pdf';
const data=await pdfParse(fs.readFileSync(f));
const lines=String(data.text||'').replace(/\r/g,'').split('\n').map(l=>l.trim());
let start=lines.findIndex(l=>/N° Facture/i.test(l));
if(start<0) start=0;
for(let i=start;i<Math.min(lines.length,start+220);i++) console.log(String(i).padStart(4,'0')+': '+lines[i]);
