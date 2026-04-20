const Anthropic = require('@anthropic-ai/sdk');

const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PEOPLE_PATH = 'Construction Business Network/People/Active';

async function githubGet(path) {
  const encoded = path.split('/').map(p => encodeURIComponent(p)).join('/');
  const url = `https://api.github.com/repos/${REPO}/contents/${encoded}`;
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

async function getAllContacts() {
  const files = await githubGet(PEOPLE_PATH);
  if (!Array.isArray(files)) return [];

  // Fetch in batches of 10 to avoid rate limits while staying fast
  const mdFiles = files.filter(f => f.name.endsWith('.md'));
  const results = [];
  for (let i = 0; i < mdFiles.length; i += 10) {
    const batch = mdFiles.slice(i, i + 10);
    const contents = await Promise.all(batch.map(async f => {
      const content = await getFileContent(f.path);
      if (!content) return null;
      // Extract just the frontmatter + first 20 lines to keep context lean
      const lines = content.split('\n').slice(0, 40).join('\n');
      return `=== ${f.name.replace('.md', '')} ===\n${lines}`;
    }));
    results.push(...contents.filter(Boolean));
  }
  return results;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { query } = JSON.parse(event.body);
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: 'Query required' }) };

    const contacts = await getAllContacts();
    if (contacts.length === 0) return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Could not load network data' })
    };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are a strategic advisor analyzing a professional network to answer a specific request.

FULL NETWORK DATA:
${contacts.join('\n\n')}

REQUEST: ${query}

Respond with a clear, practical answer. Structure it as:
- A 1-2 sentence summary of your recommendation
- A ranked list of specific contacts who fit, with a brief reason for each (name, why they're relevant, relationship strength, and any suggested angle for the outreach)
- Any gaps or notes on who is missing from the network for this purpose

Plain text only — no markdown, no asterisks, no pound signs. Use plain labels like "TOP CONTACTS:" and "NOTES:". Write like a trusted colleague giving you a straight answer.`
      }]
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: message.content[0].text })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
