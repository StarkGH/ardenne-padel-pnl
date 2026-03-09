// src/adapters/enable-banking/client.js
// Client HTTP Enable Banking avec JWT auto-refreshé

import fetch from 'node-fetch';
import { generateJwt, BASE_URL } from './auth.js';

async function request(method, path, body = null) {
  const token = generateJwt();
  const url   = `${BASE_URL}${path}`;
  // BASE_URL = https://api.enablebanking.com

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Enable Banking ${method} ${path} → ${res.status}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

export const api = {
  get:  (path)        => request('GET',  path),
  post: (path, body)  => request('POST', path, body),
};
