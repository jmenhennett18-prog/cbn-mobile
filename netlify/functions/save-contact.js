const Anthropic = require('@anthropic-ai/sdk');

const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const PEOPLE_PATH = 'Construction Business Network/People/Active';

async function saveToGitHub(path, content, message) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64')
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'GitHub save failed');
  }
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { text } = JSON.parse(event.body);
    if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) };

    const today = new Date().toISOString().split('T')[0];
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extraction = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Extract contact information from this dictation and return a valid Obsidian markdown note.

DICTATION:
"${text}"

Today's date: ${today}

Return ONLY the markdown note, no explanation. Use this exact format:

---
name: [Full Name]
email: [email or blank]
phone: [phone or blank]
linkedin:
location_city: [city or blank]
location_state: [state or blank]
location_country: US
company: [company or blank]
industry: [array like: Construction, Real Estate — or blank]
role: [job title or blank]
work_focus:
seniority:
birthday:
alma_mater:
follow_teams: []
interests: []
relationship_type: contact
relationship_strength: 2
status: active
met_date: ${today}
met_context: [how they met or blank]
introduced_by:
last_contact: ${today}
next_followup:
tags: [contact]
---

# [Full Name]

**Company:** [[company name]] — if company known, else leave blank
**Industry:** [[industry]] — if industry known

## Notes

[Any additional context from the dictation]

## Action Items

- [ ]

---
*🔵 Remember to add wikilinks for Company and Industry in the body above.*`
      }]
    });

    const noteContent = extraction.content[0].text.trim();

    // Extract name for filename
    const nameMatch = noteContent.match(/^name:\s*(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : 'Unknown Contact';
    const companyMatch = noteContent.match(/^company:\s*(.+)$/m);
    const roleMatch = noteContent.match(/^role:\s*(.+)$/m);
    const cityMatch = noteContent.match(/^location_city:\s*(.+)$/m);
    const stateMatch = noteContent.match(/^location_state:\s*(.+)$/m);

    const filePath = `${PEOPLE_PATH}/${name}.md`;
    await saveToGitHub(filePath, noteContent, `Add contact: ${name}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        company: companyMatch ? companyMatch[1].trim() : '',
        role: roleMatch ? roleMatch[1].trim() : '',
        location: [cityMatch?.[1]?.trim(), stateMatch?.[1]?.trim()].filter(Boolean).join(', ')
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
