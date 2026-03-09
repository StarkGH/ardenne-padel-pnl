// src/adapters/enable-banking/connect.js
// Flow OAuth2 pour connecter un compte bancaire via Enable Banking
//
// Usage : node src/adapters/enable-banking/connect.js [--bank=bnp|belfius]
//
// Étapes :
//   1. Crée une session Enable Banking pour la banque choisie
//   2. Ouvre l'URL d'autorisation dans le navigateur (Windows WSL)
//   3. Attend le callback sur http://localhost:3100/callback
//   4. Sauvegarde le auth_token dans secrets/eb_sessions.json

import http from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { api, APP_ID, BASE_URL } from './client.js';

dotenv.config();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.join(__dirname, '../../../secrets/eb_sessions.json');
const REDIRECT_URI  = 'http://localhost:3100/callback';
const CALLBACK_PORT = 3100;

// ─── Banques supportées ───────────────────────────────────────────────────────
const BANKS = {
  // ── Production (vraies banques belges) ─────────────────────────────────────
  bnp: {
    name:    'BNP Paribas Fortis',
    country: 'BE',
  },
  belfius: {
    name:    'Belfius',
    country: 'BE',
  },
  // ── Sandbox (banque de test) ────────────────────────────────────────────────
  bbva: {
    name:    'BBVA',
    country: 'BE',
    sandbox_credentials: { username: 'user1', password: '1234', otp: '012345' },
  },
};

// ─── Lecture / écriture sessions ─────────────────────────────────────────────

function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
}

function saveSession(bankKey, data) {
  const sessions = loadSessions();
  sessions[bankKey] = { ...data, saved_at: new Date().toISOString() };
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  console.log(`✅ Session sauvegardée : ${SESSIONS_FILE}`);
}

// ─── Ouvrir URL dans Windows (WSL) ───────────────────────────────────────────

function openBrowser(url) {
  const cmd = `explorer.exe "${url}" 2>/dev/null || cmd.exe /c start "${url}"`;
  exec(cmd);
  console.log(`\n🌐 URL d'autorisation :\n   ${url}\n`);
  console.log('   (ouverture automatique dans le navigateur Windows)');
  console.log('   Si elle ne s\'ouvre pas : copie-colle l\'URL manuellement.\n');
}

// ─── Attendre le callback OAuth2 ─────────────────────────────────────────────

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url    = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const code   = url.searchParams.get('code');
      const sessId = url.searchParams.get('session_id') || url.searchParams.get('state');
      const error  = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(`<h2>❌ Erreur : ${error}</h2><p>Tu peux fermer cet onglet.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
      } else {
        res.end(`<h2>✅ Autorisation accordée !</h2><p>Tu peux fermer cet onglet et revenir au terminal.</p>`);
        server.close();
        resolve({ code, sessId, fullUrl: req.url });
      }
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`\n⏳ En attente du callback sur http://localhost:${CALLBACK_PORT}/callback ...`);
    });

    server.on('error', reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const bankArg = process.argv.find(a => a.startsWith('--bank='))?.split('=')[1] || 'bnp';
  const bank    = BANKS[bankArg];

  if (!bank) {
    console.error(`❌ Banque inconnue : ${bankArg}. Options : ${Object.keys(BANKS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(` Enable Banking — Connexion ${bank.name}`);
  console.log(` Environnement : SANDBOX`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // 1. POST /auth → obtenir l'URL d'autorisation bancaire
  console.log('>>> Initialisation de l\'autorisation...');
  let authResponse;
  try {
    authResponse = await api.post('/auth', {
      access: {
        valid_until:  new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        balances:     true,
        transactions: true,
      },
      aspsp: {
        name:    bank.name,
        country: bank.country,
      },
      state:        `ardenne-padel-${bankArg}-${Date.now()}`,
      redirect_url: REDIRECT_URI,
      psu_type:     'business',
    });
  } catch (err) {
    console.error('❌ Erreur POST /auth :', err.message);
    process.exit(1);
  }

  const { url: authUrl, authorization_id } = authResponse;
  console.log(`✅ Autorisation initiée : ${authorization_id}`);
  if (!authUrl) {
    console.error('❌ Pas d\'URL dans la réponse /auth :', JSON.stringify(authResponse, null, 2));
    process.exit(1);
  }

  openBrowser(authUrl);

  // 3. Attendre le callback avec le code OAuth2
  let callbackData;
  try {
    callbackData = await waitForCallback();
  } catch (err) {
    console.error('❌ Erreur callback :', err.message);
    process.exit(1);
  }

  console.log(`\n✅ Callback reçu !`);
  console.log(`   Code          : ${callbackData.code}`);

  // 4. POST /sessions → échanger le code contre une session
  console.log('\n>>> Échange du code contre une session...');
  let sessionData;
  try {
    sessionData = await api.post('/sessions', { code: callbackData.code });
  } catch (err) {
    console.error('❌ Erreur POST /sessions :', err.message);
    process.exit(1);
  }
  console.log(`✅ Session obtenue : ${sessionData.session_id || JSON.stringify(sessionData).slice(0,80)}`);

  // 5. Sauvegarder la session complète
  saveSession(bankArg, {
    bank_name:      bank.name,
    institution:    bank.name,
    authorization_id,
    session_id:     sessionData.session_id,
    accounts:       sessionData.accounts || [],
    session_data:   sessionData,
  });

  console.log('\n🎉 Connexion établie ! Lance maintenant :');
  console.log(`   npm run import:bnp\n`);
}

main().catch(err => {
  console.error('❌ Erreur fatale :', err.message);
  process.exit(1);
});
