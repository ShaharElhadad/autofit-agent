const Imap = require('imap');
const { simpleParser } = require('mailparser');

/**
 * Waits for AutoFit 6-digit verification code from email.
 * Connects to IMAP, listens for new mail from AutoFit, extracts code.
 */
async function waitForAutoFitCode(timeoutMs = 60000) {
  const config = {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  };

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);

    const timeout = setTimeout(() => {
      imap.end();
      reject(new Error('Timeout waiting for AutoFit verification code'));
    }, timeoutMs);

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }

        // Check existing unseen messages first
        searchForCode(imap, (code) => {
          if (code) {
            clearTimeout(timeout);
            imap.end();
            resolve(code);
            return;
          }

          // Listen for new messages
          imap.on('mail', () => {
            searchForCode(imap, (code) => {
              if (code) {
                clearTimeout(timeout);
                imap.end();
                resolve(code);
              }
            });
          });
        });
      });
    });

    imap.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    imap.connect();
  });
}

function searchForCode(imap, callback) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const searchCriteria = [
    'UNSEEN',
    ['SINCE', fiveMinAgo]
  ];

  imap.search(searchCriteria, (err, results) => {
    if (err || !results || !results.length) {
      callback(null);
      return;
    }

    // Get the latest message
    const latest = results[results.length - 1];
    const fetch = imap.fetch(latest, { bodies: '', markSeen: true });

    fetch.on('message', (msg) => {
      msg.on('body', (stream) => {
        simpleParser(stream, (err, parsed) => {
          if (err) {
            callback(null);
            return;
          }

          // Check if from AutoFit
          const from = (parsed.from?.text || '').toLowerCase();
          if (!from.includes('autofit') && !from.includes('auto-fit')) {
            callback(null);
            return;
          }

          // Extract 6-digit code
          const text = (parsed.text || '') + (parsed.html || '');
          const match = text.match(/\b(\d{6})\b/);

          if (match) {
            callback(match[1]);
          } else {
            callback(null);
          }
        });
      });
    });

    fetch.once('end', () => {
      // If no code found in this batch
    });
  });
}

module.exports = { waitForAutoFitCode };
