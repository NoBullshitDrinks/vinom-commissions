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

    // Détecter si le message contient un PDF et l'extraire en texte
    if (body.messages && body.messages.length > 0) {
      const msg = body.messages[0];
      if (msg.content && Array.isArray(msg.content)) {
        const newContent = [];
        let pdfText = null;

        for (const block of msg.content) {
          if (block.type === 'document' && 
              block.source && 
              block.source.media_type === 'application/pdf' &&
              block.source.type === 'base64') {
            
            // Extraire le texte du PDF avec pdftotext -layout
            try {
              const tmpDir = os.tmpdir();
              const tmpPdf = path.join(tmpDir, `pdf_${Date.now()}.pdf`);
              const pdfBuffer = Buffer.from(block.source.data, 'base64');
              fs.writeFileSync(tmpPdf, pdfBuffer);
              
              const extracted = execSync(`pdftotext -layout "${tmpPdf}" -`, {
                timeout: 15000,
                maxBuffer: 1024 * 1024 * 5
              }).toString();
              
              fs.unlinkSync(tmpPdf);
              pdfText = extracted;
              
              // Remplacer le bloc PDF par du texte
              newContent.push({
                type: 'text',
                text: `Contenu du PDF (extrait avec mise en page préservée):\n\n${extracted}`
              });
            } catch (e) {
              // Si pdftotext échoue, garder le PDF original
              newContent.push(block);
            }
          } else {
            newContent.push(block);
          }
        }
        
        body.messages[0].content = newContent;
      }
    }

    // Appel API Anthropic
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
