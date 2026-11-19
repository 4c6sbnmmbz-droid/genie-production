// Genie 2.0 production service, Approved -> Scheduled (Notion 4.4d section 2).
// Started by the Airtable automation "Production Service - Approved" the moment a 2.0 record
// is approved, plus a daily Vercel cron as the backstop. Takes Approved 2.0 records with a hosted image,
// creates the Buffer post at the record's Publish Date, writes the Buffer Post ID back,
// and records every step in the Audit Trail. Never generates images, never posts now,
// never moves a slot, never shortens copy. Failures hold the record for Doc.

import { T, F, A, H, CHANNELS, MAX_PER_RUN, LEASE_MINUTES, MIN_LEAD_MINUTES } from '../lib/config.js';
import * as at from '../lib/airtable.js';
import { createPost, editPost, readPost } from '../lib/buffer.js';

const REVISE_CUTOFF_MINUTES = 120; // Marty's rule: never edit a post inside 2 hours of going out.

const sel = v => (v && typeof v === 'object' && v.name) ? v.name : v;
const etStamp = d => d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.authorization === `Bearer ${secret}`) return true;
  const t = req.query && req.query.token;
  return Boolean(t) && (t === secret || t === process.env.NUDGE_TOKEN);
}

async function audit(runId, recordId, event, type, why) {
  try {
    const row = await at.create(T.audit, {
      [A.event]: `Production: ${event}`,
      [A.when]: new Date().toISOString(),
      [A.type]: type,
      [A.system]: 'Vercel',
      [A.target]: recordId,
      [A.why]: why.slice(0, 5000),
      [A.actor]: 'Production Service',
      [A.project]: 'Strategic Friction',
      [A.detail]: runId,
    });
    return row.id;
  } catch (e) {
    return `audit-failed(${String(e.message).slice(0, 120)})`;
  }
}

// Notes stays under 3,000 characters (runtime rule): a long cell gets a short pointer instead.
function appendNote(existing, line) {
  const cur = existing || '';
  const join = s => (cur ? `${cur}\n${s}` : s);
  if (join(line).length <= 3000) return join(line);
  const m = line.match(/Audit (\S+)/);
  const short = `${line.slice(0, 22)}: see Audit ${m ? m[1] : ''}`.trim();
  return join(short).length <= 3000 ? join(short) : cur;
}

async function holdForDoc(runId, rec, step, error) {
  const now = new Date();
  const auditId = await audit(runId, rec.id, `${step} — failed`, 'Defect',
    `Production service could not ${step.toLowerCase()} this record and has held it for Doc. Error: ${error}. Status left at Approved; nothing was posted. Doc clears Production Hold once fixed and the next sweep resumes.`);
  try {
    await at.update(T.pipeline, rec.id, {
      [F.hold]: true,
      [F.step]: 'Failed',
      [F.owner]: 'Doc',
      [F.claimedBy]: null,
      [F.claimedAt]: null,
      [F.notes]: appendNote(rec.fields[F.notes], `PROD ${etStamp(now)} ET: ${step} failed — see Audit ${auditId}`),
    });
  } catch (e) {
    await audit(runId, rec.id, 'Hold write — failed', 'Defect', `Could not set Production Hold after a ${step} failure: ${e.message}`);
  }
  return { id: rec.id, result: 'held', step, error };
}

async function processRecord(runId, rec) {
  const f = rec.fields;
  // Lease: skip a record another production run holds.
  const holder = f[F.claimedBy];
  const heldAt = f[F.claimedAt] ? new Date(f[F.claimedAt]) : null;
  if (holder && String(holder).startsWith('prod_') && holder !== runId && heldAt && (Date.now() - heldAt.getTime()) < LEASE_MINUTES * 60000) {
    return { id: rec.id, result: 'skipped-leased' };
  }
  await at.update(T.pipeline, rec.id, { [F.claimedBy]: runId, [F.claimedAt]: new Date().toISOString(), [F.runId]: runId });
  const back = await at.get(T.pipeline, rec.id);
  if (back.fields[F.claimedBy] !== runId) return { id: rec.id, result: 'skipped-lost-lease' };
  const r = { id: rec.id, fields: back.fields };
  const g = r.fields;

  await audit(runId, rec.id, 'Run start — complete', 'Verification',
    `Approved 2.0 record taken by the production service (${g[F.bufferId] ? 'revision of Buffer ' + g[F.bufferId] : 'new post'}). Production Step on entry: ${sel(g[F.step]) || 'empty'}. Test mode (Buffer draft): ${process.env.BUFFER_SAVE_TO_DRAFT === 'true' ? 'on' : 'off'}.`);

  // A record that already has a Buffer post is a revision: update that post, never create a second.
  const existingId = g[F.bufferId] || null;

  // Pre-checks.
  const platform = sel(g[F.platform]);
  const ch = CHANNELS[platform];
  const copy = g[F.finalCopy];
  const due = g[F.publishDate] ? new Date(g[F.publishDate]) : null;
  const url = g[F.hostedUrl];
  const problems = [];
  if (!ch) problems.push(`Platform "${platform || 'empty'}" has no Buffer channel`);
  if (!copy) problems.push('Final Copy is empty');
  if (!due) problems.push('Publish Date is empty');
  else if (due.getTime() < Date.now() + MIN_LEAD_MINUTES * 60000) problems.push(`Publish Date ${due.toISOString()} is less than ${MIN_LEAD_MINUTES} minutes away or past`);
  if (!url) problems.push('Hosted Image URL is empty');
  if (g[F.classComplete] !== 1) problems.push('Classification Complete is not 1');
  if (ch && ch.maxChars && copy && [...copy].length > ch.maxChars) problems.push(`Final Copy is ${[...copy].length} characters; ${platform} allows ${ch.maxChars}`);
  if (url && !problems.length) {
    try {
      const h = await fetch(url, { method: 'HEAD' });
      const ct = h.headers.get('content-type') || '';
      if (h.status !== 200 || !ct.startsWith('image/')) problems.push(`Hosted Image URL returned ${h.status} ${ct}`);
    } catch (e) { problems.push(`Hosted Image URL unreachable: ${e.message}`); }
  }
  if (problems.length) return holdForDoc(runId, r, 'Pre-check', problems.join('; '));

  // Alt text: headline from the image request plus the title, joined mechanically.
  let headline = '';
  try { headline = JSON.parse(g[F.request] || '{}').headline || ''; } catch (e) { /* none */ }
  const altText = [headline, g[F.title]].filter(Boolean).join(' — ').slice(0, 400) || 'Strategic Friction card';

  const draft = process.env.BUFFER_SAVE_TO_DRAFT === 'true';
  const input = {
    text: copy,
    channelId: ch.id,
    schedulingType: 'automatic',
    mode: 'customScheduled',
    dueAt: due.toISOString(),
    needsApproval: false,
    saveToDraft: draft,
    source: 'genie-production',
    assets: [{ image: { url, metadata: { altText } } }],
  };
  if (ch.metadata) input.metadata = ch.metadata;
  // Airtable owns the approved comment, including clearing it on revision.
  if (platform === 'LinkedIn') {
    input.metadata = { ...input.metadata, linkedin: { ...input.metadata?.linkedin, firstComment: g[F.firstComment] || '' } };
  }

  if (existingId) return revise(runId, r, existingId, input, { platform, ch, due, url, draft });

  let res = await createPost(input);
  if (!res.ok && res.retryable) { await new Promise(s => setTimeout(s, 3000)); res = await createPost(input); }
  if (!res.ok) {
    if (res.retryable) {
      // Leave it Approved and unheld for the next sweep; release the lease.
      await at.update(T.pipeline, rec.id, { [F.claimedBy]: null, [F.claimedAt]: null });
      await audit(runId, rec.id, 'Schedule — deferred', 'Verification', `Buffer busy (${res.message}); left for the next sweep.`);
      return { id: rec.id, result: 'deferred', error: res.message };
    }
    return holdForDoc(runId, r, 'Schedule', `Buffer refused the post: ${res.message}`);
  }

  if (platform === 'LinkedIn') {
    // Persist the join key before verification: a read failure must never create a duplicate.
    await at.update(T.pipeline, rec.id, { [F.bufferId]: res.id });
    const error = await checkFirstComment(res.id, input.metadata.linkedin.firstComment);
    if (error) return holdForDoc(runId, r, 'First comment verification', error);
    await audit(runId, rec.id, 'First comment — verified', 'Verification', `Buffer post ${res.id}: LinkedIn first comment exactly matches Airtable (${input.metadata.linkedin.firstComment.length} characters).`);
  }

  // One write: key, status, step, owner, lease cleared, Notes line.
  const schedAudit = await audit(runId, rec.id, `Schedule — complete${draft ? ' (Buffer draft, test mode)' : ''}`, 'Change',
    `Buffer post ${res.id} created on ${platform} (channel ${ch.id}) for ${due.toISOString()} (Publish Date). ${draft ? 'Saved as a Buffer DRAFT (test mode): it cannot publish until promoted.' : 'Scheduled live.'} Image ${url}.`);
  const fields = {
    [F.bufferId]: res.id,
    [F.status]: 'Scheduled',
    [F.step]: 'Posted',
    [F.owner]: 'Buffer',
    [F.claimedBy]: null,
    [F.claimedAt]: null,
    [F.notes]: appendNote(g[F.notes], `PROD ${etStamp(new Date())} ET: Approved→Scheduled, Buffer ${res.id}${draft ? ' (draft, test mode)' : ''}, Audit ${schedAudit}`),
  };
  let wrote = false, lastErr = '';
  for (let i = 0; i < 3 && !wrote; i++) {
    try { await at.update(T.pipeline, rec.id, fields); wrote = true; } catch (e) { lastErr = e.message; await new Promise(s => setTimeout(s, 1500)); }
  }
  if (!wrote) {
    await audit(runId, rec.id, 'SCHEDULED, NO KEY', 'Defect',
      `Buffer post ${res.id} EXISTS but the Airtable write-back failed 3 times (${lastErr}). The record still reads Approved. Do not re-run it: write Buffer Post ID ${res.id} by hand or delete that Buffer post first.`);
    try { await at.update(T.pipeline, rec.id, { [F.hold]: true, [F.owner]: 'Doc' }); } catch (e) { /* audit row above is the record */ }
    return { id: rec.id, result: 'scheduled-no-key', bufferId: res.id };
  }
  return { id: rec.id, result: draft ? 'scheduled-draft' : 'scheduled', bufferId: res.id };
}

// Revision: the record was re-approved after scheduling (copy, date or image changed).
// Update the existing Buffer post in place. Never inside 2 hours of going out, never on a
// post Buffer has already sent, never a second post.
async function revise(runId, r, postId, input, { platform, ch, due, url, draft }) {
  const cur = await readPost(postId);
  if (!cur.ok) return holdForDoc(runId, r, 'Revise', `Could not read Buffer post ${postId}: ${cur.message}`);
  if (cur.status === 'sent' || cur.status === 'sending') return holdForDoc(runId, r, 'Revise', `Buffer post ${postId} has already gone out (status ${cur.status}); it cannot be revised`);
  const goesOut = cur.dueAt ? new Date(cur.dueAt).getTime() : due.getTime();
  if (goesOut - Date.now() < REVISE_CUTOFF_MINUTES * 60000) return holdForDoc(runId, r, 'Revise', `Buffer post ${postId} goes out at ${cur.dueAt}, inside the ${REVISE_CUTOFF_MINUTES}-minute no-edit window`);
  // Keep a draft a draft in test mode; never turn a live post into a draft.
  const keepDraft = cur.status === 'draft' ? draft : false;
  const edit = {
    id: postId,
    text: input.text,
    assets: input.assets,
    schedulingType: 'automatic',
    mode: 'customScheduled',
    dueAt: input.dueAt,
    saveToDraft: keepDraft,
    source: 'genie-production',
  };
  if (input.metadata) edit.metadata = input.metadata;
  const res = await editPost(edit);
  if (!res.ok) return holdForDoc(runId, r, 'Revise', `Buffer refused the edit: ${res.message}`);
  if (res.id !== postId) return holdForDoc(runId, r, 'Revise', `Buffer returned a different post ID (${res.id}) for edited post ${postId}`);
  if (platform === 'LinkedIn') {
    const error = await checkFirstComment(postId, input.metadata.linkedin.firstComment);
    if (error) return holdForDoc(runId, r, 'First comment verification', error);
    await audit(runId, r.id, 'First comment — verified', 'Verification', `Buffer post ${postId}: LinkedIn first comment exactly matches Airtable (${input.metadata.linkedin.firstComment.length} characters).`);
  }
  const aid = await audit(runId, r.id, `Revise — complete${keepDraft ? ' (Buffer draft, test mode)' : ''}`, 'Change',
    `Buffer post ${postId} on ${platform} updated in place from the re-approved record: copy, image ${url} and time ${due.toISOString()} (was ${cur.dueAt}). Same post ID; no second post.`);
  await at.update(T.pipeline, r.id, {
    [F.status]: 'Scheduled',
    [F.step]: 'Posted',
    [F.owner]: 'Buffer',
    [F.claimedBy]: null,
    [F.claimedAt]: null,
    [F.notes]: appendNote(r.fields[F.notes], `PROD ${etStamp(new Date())} ET: re-approved→Scheduled, Buffer ${postId} revised in place, Audit ${aid}`),
  });
  return { id: r.id, result: 'revised', bufferId: postId };
}

async function checkFirstComment(postId, expected) {
  const post = await readPost(postId);
  if (!post.ok) return `Could not read back first comment on Buffer post ${postId}: ${post.message}`;
  if ((post.metadata?.firstComment || '') !== expected) return `Buffer post ${postId}: LinkedIn first comment differs from Airtable`;
  return null;
}

async function health(fields) {
  const row = process.env.WORKER_ROW;
  if (!row) return;
  try { await at.update(T.health, row, fields); } catch (e) { /* never fail the sweep on health */ }
}

export default async function handler(req, res) {
  if (!authorized(req)) { res.status(401).json({ error: 'unauthorized' }); return; }
  const runId = `prod_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await health({ [H.heartbeat]: new Date().toISOString(), [H.lastSession]: runId });
  if (process.env.PRODUCTION_ENABLED !== 'true') {
    await health({ [H.completion]: new Date().toISOString(), [H.lastRunStatus]: 'Succeeded' });
    res.status(200).json({ runId, disabled: true });
    return;
  }
  const results = [];
  let failed = false;
  try {
    const platforms = Object.keys(CHANNELS).map(p => `{Platform}='${p}'`).join(',');
    const formula = `AND({Status}='Approved',{Pipeline Version}='2.0',NOT({Production Hold}),NOT({Loop Guard}),OR(${platforms}))`;
    const recs = await at.list(T.pipeline, { formula, sortField: 'Status Changed At', max: MAX_PER_RUN });
    for (const rec of recs) {
      try { results.push(await processRecord(runId, rec)); }
      catch (e) { failed = true; results.push(await holdForDoc(runId, rec, 'Run', e.message)); }
    }
  } catch (e) {
    failed = true;
    results.push({ error: e.message });
  }
  await health({ [H.completion]: new Date().toISOString(), [H.lastRunStatus]: failed ? 'Failed' : 'Succeeded', [H.state]: failed ? 'Failed' : 'Healthy' });
  res.status(200).json({ runId, count: results.length, results });
}
