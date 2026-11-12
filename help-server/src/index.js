// Loopsy Doopsy help server (optional). A Cloudflare Worker with two jobs:
//   POST /ask       answers "how do I…" questions about the app with Claude
//   POST /feedback  stores a suggestion or problem report
//   GET  /feedback?key=ADMIN_KEY   lists what people have sent (newest first)
//
// Cost guard rails: a daily cap on AI answers for everyone together and per person, short
// answers, and (recommended) prepaid API credit with auto-reload switched off, so the most
// it can ever spend is what you've put in.
import Anthropic from '@anthropic-ai/sdk';
import { GUIDE } from './guide.js';

const SYSTEM = `You are the friendly helper inside Loopsy Doopsy, a loop recorder app for humming and singing. Answer questions about using the app, and gentle general questions about looping and music-making that relate to it. Many people asking are beginners and some are children: use plain, warm, short answers (usually 2-5 sentences or a few steps), naming the exact buttons. If you don't know, or it sounds like a bug, say so and suggest they send it through the "Suggest" tab so the maker sees it. Don't invent features. Politely decline anything unrelated to the app or music-making.

Here is how the app works:

${GUIDE}`;

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });
const today = () => new Date().toISOString().slice(0, 10);

// Count one use against a daily limit; false once it's used up.
async function spend(kv, key, limit) {
  const k = `n:${today()}:${key}`;
  const n = Number((await kv.get(k)) || 0);
  if (n >= limit) return false;
  await kv.put(k, String(n + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim());
    const cors = allowed.includes(origin) || origin.startsWith('http://localhost')
      ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' }
      : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';

    if (url.pathname === '/feedback' && req.method === 'GET') {
      if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return json({ error: 'nope' }, 403, cors);
      const list = await env.HELP_KV.list({ prefix: 'fb:', limit: 500 });
      const items = await Promise.all(list.keys.map(async (k) => JSON.parse(await env.HELP_KV.get(k.name))));
      return json(items.sort((a, b) => b.at.localeCompare(a.at)), 200, cors);
    }

    if (req.method !== 'POST' || !cors['access-control-allow-origin']) return json({ error: 'not found' }, 404, cors);
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad request' }, 400, cors);
    }

    if (url.pathname === '/feedback') {
      const text = String(body.text || '').trim().slice(0, 4000);
      if (!text) return json({ error: 'empty' }, 400, cors);
      if (!(await spend(env.HELP_KV, `fb:${ip}`, 20))) return json({ error: 'Too many today — try again tomorrow' }, 429, cors);
      const at = new Date().toISOString();
      const item = { at, kind: String(body.kind || 'other').slice(0, 20), text, device: String(body.device || '').slice(0, 300), version: String(body.version || '').slice(0, 40) };
      await env.HELP_KV.put(`fb:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(item));
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === '/ask') {
      const question = String(body.question || '').trim().slice(0, 1000);
      if (!question) return json({ error: 'empty' }, 400, cors);
      // Up to a few earlier turns, so follow-up questions make sense.
      const history = (Array.isArray(body.history) ? body.history : [])
        .slice(-6)
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
      while (history.length && history[0].role !== 'user') history.shift();
      if (!(await spend(env.HELP_KV, `ask:${ip}`, Number(env.PER_PERSON_DAILY_LIMIT || 15)))) {
        return json({ error: 'That’s the most questions for today — try again tomorrow, or send it through Suggest.' }, 429, cors);
      }
      if (!(await spend(env.HELP_KV, 'ask:all', Number(env.DAILY_LIMIT || 200)))) {
        return json({ error: 'The helper is resting for today — try again tomorrow, or send it through Suggest.' }, 429, cors);
      }
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      try {
        const res = await client.beta.messages.create({
          model: env.MODEL || 'claude-opus-5-5',
          max_tokens: 2000,
          output_config: { effort: 'low' },
          // If the main model declines, a fallback model can answer instead.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          messages: [...history, { role: 'user', content: question }],
        });
        if (res.stop_reason === 'refusal') return json({ answer: 'Sorry, I can only help with Loopsy Doopsy and making music with it.' }, 200, cors);
        const answer = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return json({ answer: answer || 'Sorry, I’m not sure — try sending it through Suggest.' }, 200, cors);
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) return json({ error: 'The helper is busy — try again in a minute.' }, 503, cors);
        if (e instanceof Anthropic.APIError) {
          console.error('anthropic', e.status, e.message);
          return json({ error: 'The helper isn’t available right now.' }, 502, cors);
        }
        throw e;
      }
    }
    return json({ error: 'not found' }, 404, cors);
  },
};
