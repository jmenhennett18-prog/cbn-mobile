const Anthropic = require('@anthropic-ai/sdk');

const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const ALLOWED = (process.env.ALLOWED_WHATSAPP || '').split(',').map(n => n.trim());
const PEOPLE_PATH = 'Construction Business Network/People/Active';
const INTERACTIONS_PATH = 'Construction Business Network/Interactions';

function twiml(msg) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`
  };
}

async function githubGet(path) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return null;
  return res.json();
}

async function getFileContent(path) {
  const data = await githubGet(path);
  if (!data?.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

async function findContact(name) {
  const files = await githubGet(PEOPLE_PATH);
  if (!Array.isArray(files)) return null;
  const lower = name.toLowerCase();
  const parts = lower.split(' ').filter(Boolean);
  const match = files.find(f => {
    const fname = f.name.toLowerCase().replace('.md', '');
    return fname === lower || parts.every(p => fname.includes(p));
  });
  return match ? { name: match.name.replace('.md', ''), path: match.path } : null;
}

async function getRecentInteractions(contactName, limit = 3) {
  const results = [];
  const firstName = contactName.split(' ')[0].toLowerCase();
  const lastName = contactName.split(' ').slice(-1)[0].toLowerCase();

  async function walkDir(dirPath) {
    const items = await githubGet(dirPath);
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.type === 'dir') await walkDir(item.path);
      else if (item.name.endsWith('.md')) {
        const content = await getFileContent(item.path);
        if (content?.toLowerCase().includes(firstName) && content?.toLowerCase().includes(lastName)) {
          results.push({ name: item.name, content });
        }
      }
    }
  }

  await walkDir(INTERACTIONS_PATH);
  return results.slice(-limit);
}

async function generateBrief(name) {
  const contact = await findContact(name);
  if (!contact) return `No contact found for "${name}". Check the spelling.`;

  const noteContent = await getFileContent(contact.path);
  const interactions = await getRecentInteractions(contact.name);
  const interactionText = interactions.length > 0
    ? interactions.map(i => `--- ${i.name} ---\n${i.content}`).join('\n\n')
    : 'No logged interactions yet.';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Pre-meeting brief for ${contact.name}. WhatsApp format — keep it under 400 words, use short bullet points, no headers, plain text only (no markdown).

CONTACT NOTE:
${noteContent}

RECENT INTERACTIONS:
${interactionText}

Cover: who they are, how we know them, last talked about, personal details, 2 talking points.`
    }]
  });

  return `*${contact.name}*\n\n${message.content[0].text}`;
}

async function answerQuestion(question, from) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Get a sample of contacts for context
  const files = await githubGet(PEOPLE_PATH);
  let networkContext = '';
  if (Array.isArray(files)) {
    const sample = files.slice(0, 20);
    const contents = await Promise.all(sample.map(f => getFileContent(f.path)));
    networkContext = contents.filter(Boolean).join('\n\n---\n\n');
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are an assistant for a professional network CRM. Answer this question about the network concisely for WhatsApp (plain text, no markdown, under 300 words).

QUESTION: ${question}

NETWORK SAMPLE (partial):
${networkContext}

If you can't answer from the data provided, say so clearly.`
    }]
  });

  return message.content[0].text;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const params = new URLSearchParams(event.body);
  const from = params.get('From') || '';
  const body = (params.get('Body') || '').trim();

  // Security: only respond to allowed numbers
  if (ALLOWED.length > 0 && !ALLOWED.some(n => from.includes(n))) {
    return twiml('Sorry, this number is not authorized.');
  }

  if (!body) return twiml('Send me a message! Try: "brief Wesley Stanley"');

  const lower = body.toLowerCase();

  try {
    if (lower.startsWith('brief ') || lower.startsWith('brief:')) {
      const name = body.replace(/^brief:?\s*/i, '').trim();
      const brief = await generateBrief(name);
      return twiml(brief);
    }

    if (lower === 'help' || lower === '?') {
      return twiml(
        'CBN Assistant\n\n' +
        '• "brief [name]" — pre-meeting brief\n' +
        '• Any question — ask about your network\n\n' +
        'To add contacts or log interactions, use the web app.'
      );
    }

    // General network question
    const answer = await answerQuestion(body, from);
    return twiml(answer);

  } catch (err) {
    return twiml('Something went wrong: ' + err.message);
  }
};
