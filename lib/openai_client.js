/**
 * OpenAI API client with JSON mode support
 */
const config = require('../config/env');

/**
 * Make a chat completion request with JSON schema enforcement
 */
async function openaiChatJSON({ model = 'gpt-4o-mini', messages, jsonSchema, temperature = 0.2 }) {
  const apiKey = config.openaiApiKey;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured. Check your .env file.');
  }

  // Use Responses API with structured outputs
  const body = {
    model,
    input: messages.map(m => ({ 
      role: m.role, 
      content: [{ type: 'input_text', text: m.content }] 
    })),
    temperature,
  };

  if (jsonSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: 'result',
        schema: jsonSchema,
        strict: true,
      },
    };
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }

  const data = await res.json();

  // Extract output text
  let outText = data.output_text;

  if (!outText && Array.isArray(data.output)) {
    for (const o of data.output) {
      if (o?.type === 'message' && Array.isArray(o.content)) {
        const c = o.content.find(x => x?.type === 'output_text' && typeof x.text === 'string');
        if (c) { 
          outText = c.text; 
          break; 
        }
      }
    }
  }

  if (!outText) {
    throw new Error('No output_text in response');
  }

  try {
    return JSON.parse(outText);
  } catch {
    return { raw: outText };
  }
}

/**
 * Simple chat completion without JSON schema
 */
async function openaiChat({ model = 'gpt-4o-mini', messages, temperature = 0.2 }) {
  const apiKey = config.openaiApiKey;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${t}`);
  }

  const data = await res.json();
  return data.choices[0]?.message?.content || '';
}

module.exports = { openaiChatJSON, openaiChat };
