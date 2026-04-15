const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
    let body = JSON.parse(event.body);

    // Mode spécial : compter les pages d'un PDF (action = "pdf_page_count")
    if (body.action === 'pdf_page_count' && body.pdf_base64) {
      const tmpDir = os.tmpdir();
      const tmpPdf = path.join(tmpDir, `pdf_count_${Date.now()}.pdf`);
      fs.writeFileSync(tmpPdf, Buffer.from(body.pdf_base64, 'base64'));
      let pageCount = 1;
      try {
        const info = execSync(`pdfinfo "${tmpPdf}" 2>/dev/null || echo "Pages: 1"`, {
          timeout: 10000
        }).toString();
        const m = info.match(/Pages:\s*(\d+)/i);
        if (m) pageCount = parseInt(m[1]);
      } catch(e) { pageCount = 1; }
      try { fs.unlinkSync(tmpPdf); } catch(e) {}
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_count: pageCount })
      };
    }

    // Détecter si le message contient un PDF et l'extraire en texte
    if (body.messages && body.messages.length > 0) {
      const msg = body.messages[0];
      if (msg.content && Array.isArray(msg.content)) {
        const newContent = [];

        for (const block of msg.content) {
          if (block.type === 'document' &&
              block.source &&
              block.source.media_type === 'application/pdf' &&
              block.source.type === 'base64') {

            try {
              const tmpDir = os.tmpdir();
              const tmpPdf = path.join(tmpDir, `pdf_${Date.now()}.pdf`);
              fs.writeFileSync(tmpPdf, Buffer.from(block.source.data, 'base64'));

              // Plage de pages optionnelle : {first: N, last: M}
              let pageArgs = '';
              if (body.pdf_page_range) {
                const { first, last } = body.pdf_page_range;
                if (first) pageArgs += ` -f ${first}`;
                if (last)  pageArgs += ` -l ${last}`;
              }

              const extracted = execSync(`pdftotext -layout${pageArgs} "${tmpPdf}" -`, {
                timeout: 15000,
                maxBuffer: 1024 * 1024 * 5
              }).toString();

              try { fs.unlinkSync(tmpPdf); } catch(e) {}

              newContent.push({
                type: 'text',
                text: `Contenu du PDF (extrait avec mise en page préservée):\n\n${extracted}`
              });
            } catch (e) {
              newContent.push(block);
            }
          } else {
            newContent.push(block);
          }
        }

        body.messages[0].content = newContent;
      }
    }

    // Retirer le paramètre interne avant d'envoyer à Anthropic
    delete body.pdf_page_range;
    delete body.action;
    delete body.pdf_base64;

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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
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
