import { pool } from '/home/stark2026/projects/ardenne-padel-pnl/db.js';

const SUPS = ['DETREMBLEUR','COLRUYT','COMARCHE'];
const c = await pool.connect();
try {
  const invQ = await c.query(`
    SELECT i.id, s.code AS supplier_code, i.invoice_number, i.invoice_date,
           i.total_a_payer, i.vidanges_livrees, i.vidanges_reprises,
           i.source_file
    FROM invoices i
    JOIN suppliers s ON s.id=i.supplier_id
    WHERE s.code = ANY($1::text[])
    ORDER BY s.code, i.invoice_date, i.id
  `, [SUPS]);

  const summaryBySup = {};
  const mismatches = [];
  const missingFiles = [];

  for (const inv of invQ.rows) {
    if (!summaryBySup[inv.supplier_code]) {
      summaryBySup[inv.supplier_code] = {
        invoices: 0,
        lines: 0,
        with_vid_line: 0,
        with_header_vidanges: 0,
        missing_tva_rate_lines: 0,
        missing_line_total_lines: 0,
      };
    }
    const s = summaryBySup[inv.supplier_code];
    s.invoices += 1;

    const lq = await c.query(`
      SELECT id, line_type, quantity_colis, quantity_total, unit_price, net_unit_price,
             line_total_htva, tva_rate, vid_unit, vid_total
      FROM invoice_lines
      WHERE invoice_id=$1
      ORDER BY id
    `, [inv.id]);

    const lines = lq.rows;
    s.lines += lines.length;

    const vidSum = lines.reduce((acc, l) => acc + (Number(l.vid_total) || 0), 0);
    const hasVidLine = lines.some(l => String(l.line_type || '').toUpperCase().includes('VIDANGE') || (Number(l.vid_total) || 0) !== 0);
    if (hasVidLine) s.with_vid_line += 1;

    const headVid = (Number(inv.vidanges_livrees) || 0) + (Number(inv.vidanges_reprises) || 0);
    if (Math.abs(headVid) > 0.0001) s.with_header_vidanges += 1;

    for (const l of lines) {
      if (l.line_total_htva === null) s.missing_line_total_lines += 1;
      if (l.tva_rate === null || String(l.tva_rate).trim() === '') s.missing_tva_rate_lines += 1;
    }

    // Recompute total like UI: goods TVAC + vidanges
    const goodsTvac = lines.reduce((acc, l) => {
      const ht = Number(l.line_total_htva) || 0;
      const m = String(l.tva_rate || '').match(/[\d.,]+/);
      const pct = m ? Number(m[0].replace(',', '.')) : 0;
      return acc + ht * (1 + (Number.isFinite(pct) ? pct : 0) / 100);
    }, 0);

    const effectiveVid = Math.abs(vidSum) > 0.0001 ? vidSum : headVid;
    const calc = Math.round((goodsTvac + effectiveVid) * 100) / 100;
    const header = inv.total_a_payer === null ? null : Math.round(Number(inv.total_a_payer) * 100) / 100;

    if (header !== null && Math.abs(calc - header) > 0.02) {
      mismatches.push({
        invoice_id: inv.id,
        supplier: inv.supplier_code,
        invoice_number: inv.invoice_number,
        header_total: header,
        calc_total: calc,
        goods_tvac: Math.round(goodsTvac * 100) / 100,
        vid_sum: Math.round(vidSum * 100) / 100,
        header_vidanges: Math.round(headVid * 100) / 100,
      });
    }

    if (!inv.source_file) {
      missingFiles.push({ invoice_id: inv.id, supplier: inv.supplier_code, invoice_number: inv.invoice_number, reason: 'source_file NULL' });
    }
  }

  const out = {
    suppliers: summaryBySup,
    total_invoices: invQ.rows.length,
    mismatches_count: mismatches.length,
    mismatches: mismatches.slice(0, 20),
    missing_source_file_count: missingFiles.length,
    missing_source_file: missingFiles.slice(0, 20),
  };

  console.log(JSON.stringify(out, null, 2));
} finally {
  c.release();
  await pool.end();
}
