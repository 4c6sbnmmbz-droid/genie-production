import { BASE } from './config.js';

const API = 'https://api.airtable.com/v0';

async function call(method, path, body) {
  const r = await fetch(`${API}/${BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* keep text */ }
  if (!r.ok) {
    const msg = json && json.error ? JSON.stringify(json.error) : text.slice(0, 300);
    throw new Error(`Airtable ${method} ${path.split('?')[0]} ${r.status}: ${msg}`);
  }
  return json;
}

export async function list(table, { formula, sortField, max }) {
  const q = new URLSearchParams();
  q.set('returnFieldsByFieldId', 'true');
  if (formula) q.set('filterByFormula', formula);
  if (sortField) { q.set('sort[0][field]', sortField); q.set('sort[0][direction]', 'asc'); }
  if (max) q.set('maxRecords', String(max));
  const j = await call('GET', `${table}?${q.toString()}`);
  return j.records || [];
}

export async function get(table, id) {
  return call('GET', `${table}/${id}?returnFieldsByFieldId=true`);
}

export async function update(table, id, fields) {
  const j = await call('PATCH', `${table}?returnFieldsByFieldId=true`, { records: [{ id, fields }], typecast: true });
  return j.records[0];
}

export async function create(table, fields) {
  const j = await call('POST', `${table}?returnFieldsByFieldId=true`, { records: [{ fields }], typecast: true });
  return j.records[0];
}
