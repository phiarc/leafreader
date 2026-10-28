import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('tests/fixtures',{recursive:true});
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R >>',
  '',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>',
  '',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>',
  '',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
];
for (let page=0;page<3;page++) {
  const stream = `BT /F1 22 Tf 45 510 Td (Leaf Reader) Tj 0 -42 Td /F1 14 Tf (PDF import validation) Tj 0 -32 Td (Page ${page+1} of 3) Tj 0 -50 Td /F1 11 Tf (Books stay on this device.) Tj 0 -22 Td (Reading progress can travel with you.) Tj ET`;
  objects[3+page*2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
}
let pdf = '%PDF-1.4\n'; const offsets=[0];
for(let i=0;i<objects.length;i++){ offsets.push(Buffer.byteLength(pdf)); pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
for(const offset of offsets.slice(1)) pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile('tests/fixtures/阅读器验证.pdf',pdf);
await writeFile('tests/fixtures/GB18030编码测试.txt',Buffer.from([0xc4,0xe3,0xba,0xc3,0xa3,0xac,0xca,0xc0,0xbd,0xe7,0xa1,0xa3]));
console.log('TXT/PDF import fixtures ready.');
