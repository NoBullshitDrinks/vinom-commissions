const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Extraire le texte d'un PDF avec pdftotext, plage de pages optionnelle
function extractText(pdfPath, first, last) {
  const pageArgs = (first && last) ? ` -f ${first} -l ${last}` : '';
  try {
    return execSync(`pdftotext -layout${pageArgs} "${pdfPath}" -`, {
      timeout: 10000, maxBuffer: 1024 * 1024 * 5
    }).toString().trim();
  } catch(e) { return ''; }
}

// Convertir une page PDF en JPEG base64
function pageToBase64(pdfPath, page) {
  const tmpBase = path.join(os.tmpdir(), `pg_${Date.now()}_${page}`);
  try {
    execSync(`pdftoppm -jpeg -r 150 -f ${page} -l ${page} "${pdfPath}" "${tmpBase}"`, {
      timeout: 15000
    });
    // pdftoppm nomme le fichier tmpBase-1.jpg ou tmpBase-01.jpg etc.
    const files = fs.readdirSync(os.tmpdir())
      .filter(f => f.startsWith(path.basename(tmpBase)) && f.endsWith('.jpg'))
      .map(f => path.join(os.tmpdir(), f));
    if (!files.length) return null;
    const data = fs.readFileSync(files[0]).toString('base64');
    files.forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    return data;
  } catch(e) { return null; }
}

// Compter les pages d'un PDF
function getPageCount(pdfPath) {
  try {
    const info = execSync(`pdfinfo "${pdfPath}"`, { timeout: 5000 }).toString();
    const m = info.match(/Pages:\s*(\d+)/i);
    return m ? parseInt(m[1]) : 1;
  } catch(e) { return 1; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);

    // ── MODE OCR VISION : PDF scanné, une page à la fois ─────────────────────
    // Appelé par le HTML avec {action:'ocr_page', pdf_base64:'...', page:N}
    if (body.action === 'ocr_page') {
      const tmpPdf = path.join(os.tmpdir(), `ocr_${Date.now()}.pdf`);
      fs.writeFileSync(tmpPdf, Buffer.from(body.pdf_base64, 'base64'));
      const imgB64 = pageToBase64(tmpPdf, body.page);
      try { fs.unlinkSync(tmpPdf); } catch(e) {}
      if (!imgB64) {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Conversion image échouée' })
        };
      }
      // Appel API Claude vision avec l'image
      const apiBody = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgB64 } },
            { type: 'text', text: body.prompt }
          ]
        }]
      };
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(apiBody)
      });
      const data = await response.json();
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      };
    }

    // ── MODE COMPTAGE PAGES ───────────────────────────────────────────────────
    if (body.action === 'pdf_page_count') {
      const tmpPdf = path.join(os.tmpdir(), `count_${Date.now()}.pdf`);
      fs.writeFileSync(tmpPdf, Buffer.from(body.pdf_base64, 'base64'));
      const count = getPageCount(tmpPdf);
      try { fs.unlinkSync(tmpPdf); } catch(e) {}
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_count: count })
      };
    }

    // ── MODE STANDARD : texte brut → API (PDF natif déjà traité côté client) ─
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
