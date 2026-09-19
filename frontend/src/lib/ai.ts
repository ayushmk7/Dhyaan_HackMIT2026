// Client-side Claude calls for the connection layer (Meta challenge).
// Key ships in the demo build via EXPO_PUBLIC_ANTHROPIC_API_KEY — acceptable for a
// hackathon demo, never for production (move behind the backend at integration).
// Every function returns null when no key or on failure; callers fall back to mock.
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_KEY } from './config';

export const hasAI = ANTHROPIC_KEY.length > 0;

const client = hasAI
  ? new Anthropic({ apiKey: ANTHROPIC_KEY, dangerouslyAllowBrowser: true })
  : null;

async function ask(prompt: string, maxTokens = 2000): Promise<string | null> {
  if (!client) return null;
  try {
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = res.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : null;
  } catch (e) {
    console.warn('ai call failed, falling back to mock:', e);
    return null;
  }
}

function extractJson<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}

export interface FamilyPlan {
  headline: string; // "Mom's 82nd — Sunday the 12th at her place"
  when: string | null;
  tasks: { who: string; what: string }[];
  open_questions: string[];
  reply_text: string; // ready to paste back into the thread
}

export async function planFromThread(thread: string): Promise<FamilyPlan | null> {
  const out = await ask(
    `This is a family group-chat thread about coordinating something for an aging parent.
Synthesize it. Reply with ONLY a JSON object, no fences, shaped exactly:
{"headline": string, "when": string|null, "tasks": [{"who": string, "what": string}],
 "open_questions": [string], "reply_text": string}
- headline: the plan in one warm, plain sentence.
- when: the consensus date/time if one exists, else null.
- tasks: who committed to what (only real commitments from the thread).
- open_questions: what nobody answered yet, phrased so someone can answer in one text.
- reply_text: a short friendly summary message ready to send back to the thread.

THREAD:
${thread.slice(0, 8000)}`,
  );
  return extractJson<FamilyPlan>(out);
}

export async function draftOpeners(eventSentences: string[]): Promise<string[] | null> {
  const out = await ask(
    `These are today's observations about an 81-year-old woman named Eleanor, collected by an
elder-care system her family uses. Her daughter is about to call her.
Write exactly 3 short conversation openers for the daughter — warm, specific to these
observations, never interrogating ("ask where she went, not whether she went").
Reply with ONLY a JSON object: {"openers": [string, string, string]}

OBSERVATIONS:
${eventSentences.slice(0, 20).join('\n')}`,
    800,
  );
  const parsed = extractJson<{ openers: string[] }>(out);
  return parsed?.openers?.length ? parsed.openers.slice(0, 3) : null;
}

// ---- Her care file: care documents → structure (Dropbox "files into action") ----

export interface CareExtract {
  medications: { name: string; dose?: string; timing?: string }[];
  appointments: { title: string; when: string; where?: string; note?: string }[];
  emergency: {
    allergies: string[];
    conditions: string[];
    doctor?: { name: string; phone?: string };
  };
  summary: string; // "3 medications, 1 appointment, 1 allergy"
}

const CARE_PROMPT = `This is a care document for an elderly woman (a discharge summary, medication
list, appointment letter, or similar), provided by her family to their care app.
Extract ONLY what the document actually says — never infer, never add.
Reply with ONLY a JSON object, no fences, shaped exactly:
{"medications":[{"name":string,"dose":string,"timing":string}],
 "appointments":[{"title":string,"when":string,"where":string,"note":string}],
 "emergency":{"allergies":[string],"conditions":[string],"doctor":{"name":string,"phone":string}},
 "summary":string}
- timing in her day's terms ("with breakfast", "at night"), not medical shorthand.
- summary: one short sentence counting what you found.
- Omit/empty anything the document doesn't state. This is informational organization,
  not medical advice.`;

export async function extractCareInfo(
  input: { text: string } | { imageBase64: string; mediaType: string },
): Promise<CareExtract | null> {
  if (!client) return null;
  try {
    const content: Anthropic.ContentBlockParam[] =
      'text' in input
        ? [{ type: 'text', text: `${CARE_PROMPT}\n\nDOCUMENT:\n${input.text.slice(0, 8000)}` }]
        : [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: input.imageBase64,
              },
            },
            { type: 'text', text: CARE_PROMPT },
          ];
    const res = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content }],
    });
    const block = res.content.find((b) => b.type === 'text');
    return extractJson<CareExtract>(block && block.type === 'text' ? block.text : null);
  } catch (e) {
    console.warn('care extraction failed:', e);
    return null;
  }
}

export async function polishLetter(draft: string): Promise<string | null> {
  return ask(
    `Rewrite this week's elder-care observations as a short warm letter (under 150 words)
from "Dhyaan" to the family group chat about Eleanor's week. Plain, human, no medical
language, no bullet points, honest about anything concerning without being alarming.
Reply with only the letter text.

NOTES:
${draft.slice(0, 4000)}`,
    800,
  );
}
