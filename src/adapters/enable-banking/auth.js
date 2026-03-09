// src/adapters/enable-banking/auth.js
// Génère le JWT Bearer token pour Enable Banking (RS256)
// Format exact : https://enablebanking.com/docs/api/reference/

import fs from 'fs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const APP_ID   = process.env.ENABLE_BANKING_APP_ID;
const KEY_PATH = process.env.ENABLE_BANKING_PRIVATE_KEY_PATH;
const BASE_URL = 'https://api.enablebanking.com';

if (!APP_ID)   throw new Error('ENABLE_BANKING_APP_ID manquant dans .env');
if (!KEY_PATH) throw new Error('ENABLE_BANKING_PRIVATE_KEY_PATH manquant dans .env');

const privateKey = fs.readFileSync(KEY_PATH, 'utf8');

/**
 * Génère un JWT signé RS256 valable 1 heure
 * - header : { alg: RS256, typ: JWT, kid: APP_ID }
 * - payload : { iss, aud, iat, exp }
 */
export function generateJwt() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    { algorithm: 'RS256', keyid: APP_ID }
  );
}

export { APP_ID, BASE_URL };
