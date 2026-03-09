import fs from 'fs';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
const files=[
'/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BAR/DB/COLRUYT OCTOBRE 2025 400,28€.pdf',
'/mnt/c/Users/stark/OneDrive - Antoine Zingaro (CQFD Consult)/Boulot New/Ardenne Padel/_Finance/PNL/Shared/BDO T4 - 2025/BNP VISA/COLRUYT OCTOBRE 2025 400,28€.pdf'
];
for (const f of files){
  try{
    const d=await pdfParse(fs.readFileSync(f));
    const txt=String(d.text||'').replace(/\s+/g,' ').trim();
    console.log('\nFILE',f);
    console.log('pages',d.numpages,'chars',txt.length);
    console.log(txt.slice(0,500));
  }catch(e){
    console.log('\nFILE',f,'ERR',e.message);
  }
}
