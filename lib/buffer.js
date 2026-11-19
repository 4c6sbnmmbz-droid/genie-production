const MUTATION = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;

const EDIT = `mutation EditPost($input: EditPostInput!) {
  editPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;

const READ = `query ReadPost($id: PostId!) { post(input: { id: $id }) { id status dueAt metadata { ... on LinkedInPostMetadata { firstComment } } } }`;

async function gql(query, variables) {
  return fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BUFFER_API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
}

export async function readPost(id) {
  const r = await gql(READ, { id });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || (j.errors && j.errors.length)) return { ok: false, message: j && j.errors ? j.errors.map(e => e.message).join('; ') : `HTTP ${r.status}` };
  if (!j.data || !j.data.post) return { ok: false, message: 'post not found' };
  return { ok: true, ...j.data.post };
}

export async function editPost(input) {
  return parse(await gql(EDIT, { input }), 'editPost');
}

export async function createPost(input) {
  return parse(await gql(MUTATION, { input }), 'createPost');
}

async function parse(r, key) {
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* non-JSON */ }
  if (!r.ok || !j) {
    return { ok: false, retryable: r.status === 429 || r.status >= 500, message: `HTTP ${r.status}: ${text.slice(0, 300)}` };
  }
  if (j.errors && j.errors.length) {
    return { ok: false, retryable: false, message: j.errors.map(e => e.message).join('; ').slice(0, 500) };
  }
  const p = j.data && j.data[key];
  if (p && p.post && p.post.id) return { ok: true, id: p.post.id, dueAt: p.post.dueAt };
  return { ok: false, retryable: false, message: (p && p.message) || `Unexpected response: ${text.slice(0, 300)}` };
}
