// Talking to a project's running server from the scripts (board.mjs, job.mjs, listen.mjs, ddd.mjs):
// find it (server.json, then ports 4490–4509 by /api/health) and call its API. Node built-ins only.

import { get, request } from 'node:http';
import { APP, FIRST_PORT, LEGACY_APP, paths, PORT_TRIES, readJson } from './project.mjs';

export const HOST = '127.0.0.1';

/** Does the server on this port serve this project? */
export function probe(port, dir, timeout = 500) {
  return new Promise((ok) => {
    const req = get({ host: HOST, port, path: '/api/health', timeout }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          ok((j.app === APP || j.app === LEGACY_APP) && j.dir === dir ? port : null);
        } catch {
          ok(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}

/** The port of the server serving this project folder, or null. */
export async function findServer(dir, { port = null } = {}) {
  if (port) return probe(port, dir);
  const known = readJson(paths(dir).server)?.port;
  if (known && (await probe(known, dir))) return known;
  const ports = Array.from({ length: PORT_TRIES }, (_, i) => FIRST_PORT + i).filter((p) => p !== known);
  return (await Promise.all(ports.map((p) => probe(p, dir)))).find(Boolean) || null;
}

/** A JSON request to the server. Resolves { status, body } (body parsed when it is JSON). */
export function call(port, method, path, data) {
  return new Promise((ok, bad) => {
    const payload = data === undefined ? null : JSON.stringify(data);
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    const req = request({ host: HOST, port, path, method, headers }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let body = b;
        try {
          body = b ? JSON.parse(b) : null;
        } catch {}
        ok({ status: res.statusCode, body });
      });
    });
    req.on('error', bad);
    req.end(payload || undefined);
  });
}
