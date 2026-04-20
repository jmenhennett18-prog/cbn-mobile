const Anthropic = require('@anthropic-ai/sdk');

const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PEOPLE_PATH = 'Construction Business Network/People/Active';
const INTERACTIONS_PATH = 'Construction Business Network/Interactions';

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
  if (!data || !data.content) return null;
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

async function getRecentInteractions(contactName, limit = 5) {
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
        if (content && content.toLowerCase().includes(firstName) && content.toLowerCase().includes(lastName)) {
          results.push({ name: item.name, content });
        }
      }
    }
  }

  await walkDir(INTERACTIONS_PATH);
  return results.slice(-limit);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { name } = JSON.parse(event.body);
    if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Name required' }) };

    const contact = await findContact(name);
    if (!contact) return {
      statusCode: 404,
      body: JSON.stringify({ error: `No contact found for "${name}". Check spelling.` })
    };

    const noteContent = await getFileContent(contact.path);
    const interactions = await getRecentInteractions(contact.name);

    const interactionText = interactions.length > 0
      ? interactions.map(i => `--- ${i.name} ---\n${i.content}`).join('\n\n')
      : 'No logged interactions yet.';

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are briefing someone 30 minutes before a meeting. Be concise and practical — like a trusted colleague handing you a cheat sheet.

CONTACT NOTE:
${noteContent}

RECENT INTERACTIONS:
${interactionText}

Write a pre-meeting brief for ${contact.name}. Cover:
- Who they are (role, company, quick background)
- How we know them and relationship context
- What was last discussed and any open action items
- Personal details worth remembering (family, interests, teams, etc.)
- 2-3 suggested talking points for today

One page max. Bullet points. No fluff.`
      }]
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: message.content[0].text, contactName: contact.name })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
