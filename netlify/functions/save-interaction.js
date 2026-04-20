const Anthropic = require('@anthropic-ai/sdk');

const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

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
    const { text, author } = JSON.parse(event.body);
    if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'No text provided' }) };

    const today = new Date().toISOString().split('T')[0];
    const year = today.split('-')[0];
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extraction = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Format this interaction log dictation into a structured Obsidian note.

DICTATION:
"${text}"

Author: ${author || 'Josh'}
Today's date: ${today}

Return ONLY the markdown note, no explanation. Use this exact format:

---
date: ${today}
author: ${author || 'Josh'}
contact: [[Person Name]]
type: meeting
medium: in-person
duration_min:
initiated_by: me
location: [location if mentioned]
topics: [topics as array]
energy: positive
tags: [interaction]
---

# ${today} — [[Person Name]] — ${author || 'Josh'}

---

## What We Talked About

[Main discussion points from the dictation]

---

## About Them

[Things learned about them from the dictation]

-
-

---

## What I Shared / My Side

[What was shared from our side, if mentioned]

---

## Action Items

[Extract any action items mentioned — format as checkboxes]
- [ ] Me:
- [ ] Them:

---

## Follow-up Plan

**Next touchpoint target:** [if mentioned]
**Reason / context:** [if mentioned]

---

## Vibe Check

[One sentence on how the interaction felt, inferred from context]`
      }]
    });

    const noteContent = extraction.content[0].text.trim();

    // Extract contact name for filename
    const contactMatch = noteContent.match(/contact:\s*\[\[(.+?)\]\]/);
    const contact = contactMatch ? contactMatch[1].trim() : 'Unknown';

    const filename = `${today} - ${contact}.md`;
    const filePath = `Construction Business Network/Interactions/${year}/${filename}`;
    await saveToGitHub(filePath, noteContent, `Log interaction: ${contact} ${today}`);

    // Detect type from note
    const typeMatch = noteContent.match(/^type:\s*(.+)$/m);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact,
        date: today,
        type: typeMatch ? typeMatch[1].trim() : 'meeting'
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
