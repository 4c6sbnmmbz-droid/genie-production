// Genie 2.0 production service: fixed configuration (Notion 4.4d).
// IDs read live 2026-11-07. Secrets come only from environment variables.

export const BASE = 'app2NoFjE9cNWYbRi';
export const T = {
  pipeline: 'tblAih5l1yhut03go',
  audit: 'tblhrvEeF2fn3gUUO',
  health: 'tblHQvRDm9790y2ry',
};

// Content Pipeline fields
export const F = {
  title: 'fldzwBoSGobYbiwc5',
  status: 'fldwyfCywbZ3yDpeo',
  owner: 'fld9Q8NRJSzeW6wuE',
  version: 'fldEErIsJMY6I2JVk',
  finalCopy: 'fldFyThW4q27HL8vp',
  firstComment: 'fld2UqxsjXmNBN8lB',
  publishDate: 'fldCkXilAAZzCHHAU',
  platform: 'fldzlqtFObPkVbNDO',
  hostedUrl: 'fldZM4xENfGBnym92',
  bufferId: 'fldkUhc0Xf5aoHBpG',
  notes: 'fldIMNq26vGXMmSPW',
  claimedBy: 'fldVYstvsubRdLMUT',
  claimedAt: 'fld8zIIPcPb0mzuAT',
  loopGuard: 'fldluWtTAI8HOjsmq',
  classComplete: 'fld6rf6UKgyh0JlA8',
  request: 'fldMkOPKdXXnNsry1',
  step: 'fldQQMACLRWxzkSWN',
  runId: 'fldjTTc5va3UNu8fF',
  hold: 'fld7jQiuasyK0ji8f',
};

// Audit Trail fields
export const A = {
  event: 'fldF8YYksk38AAM1m',
  when: 'fld2b7ZGUb9AIgJXU',
  type: 'fldEJjVSKQEBElBmG',
  system: 'fldDsEGjPKVOY7XGf',
  target: 'fldMJBE4Ecyno0uue',
  why: 'fldVOD2rsCe2uHiRB',
  actor: 'fldy2dZMMFTLxmyPl',
  project: 'fldxpzlBeWN0R7zLY',
  detail: 'fldXp98HDTjyngYCf',
};

// Worker Health fields
export const H = {
  heartbeat: 'fldyNahyNqECSrKvG',
  completion: 'fldhSB3ff8QgxHj3j',
  lastRunStatus: 'fldq6O8vNggIbZaK1',
  lastSession: 'fldZb9ES56VuL7LyZ',
  state: 'fldXUtv551DDUwlZq',
};

// Platform -> Buffer channel (Buffer org 5d715623163bd7486d3657a1, read live 2026-11-07)
export const CHANNELS = {
  Instagram: { id: '6a9c74a6065799be469651b7', metadata: { instagram: { type: 'post', shouldShareToFeed: true } } },
  Facebook: { id: '6a9dee63cd8b9c702c1cf2bc', metadata: { facebook: { type: 'post' } } },
  X: { id: '5d71568195c98e4c750fbab3', metadata: null, maxChars: 280 },
  LinkedIn: { id: '6a9c764e065799be46966ed3', metadata: null },
};

export const MAX_PER_RUN = 5;
export const LEASE_MINUTES = 15;
export const MIN_LEAD_MINUTES = 30;
