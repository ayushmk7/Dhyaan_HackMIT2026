// Client-side LLM calls for the connection layer.
//
// OpenAI only. This used to fall back to Anthropic when only that key existed;
// the project is on OpenAI's track now, and two providers meant two prompt
// dialects, two response shapes and two sets of failure modes for one feature.
// One path is easier to keep correct than a fallback nobody exercises.
//
// The key ships in the demo build, which is acceptable for a hackathon and
// never for production: move these calls behind the backend at integration.
// Every function returns null when there is no key or on failure, and callers
// fall back to their mock, so the app works with no key at all.
import { OPENAI_KEY, OPENAI_MODEL } from './config';

// Defensive on purpose. `process.env.EXPO_PUBLIC_*` is inlined by Metro at
// bundle time, and a variable that is absent from .env does not always arrive
// as the empty string the `?? ''` in config.ts expects. Reading `.length` off
// it threw at MODULE scope, which takes the whole screen down before anything
// renders rather than degrading to "no AI configured".
export const hasAI = !!OPENAI_KEY;


type OaiContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

// gpt-5 family: max_completion_tokens (not max_tokens), default temperature only.
async function askOpenAI(content: OaiContent, maxTokens: number): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content }],
      // gpt-5 reasoning eats the completion budget invisibly: at 800 tokens the
      // model returned finish_reason "length" with EMPTY content (all 800 were
      // reasoning tokens). Minimal effort + a real floor keeps output flowing.
      max_completion_tokens: Math.max(maxTokens, 1500),
      reasoning_effort: 'minimal',
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? null;
  if (!text) throw new Error(`openai empty content (finish: ${data?.choices?.[0]?.finish_reason})`);
  // Model prose must obey the same copy contract as chrome: no em dashes.
  return text.replace(/\s*\u2014\s*/g, ', ');
}

async function ask(prompt: string, maxTokens = 2000): Promise<string | null> {
  try {
    if (!OPENAI_KEY) return null;
    return await askOpenAI(prompt, maxTokens);
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
    `These are today's observations about an 81-year-old woman named Asha, collected by an
elder-care system her family uses. Her daughter is about to call her.
Write exactly 3 conversation openers for her daughter Priya. Warm, specific to these
observations, never interrogating ("ask where she went, not whether she went").
EACH OPENER 8 WORDS OR FEWER — these render as one-line list items.
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
  if (!hasAI) return null;
  try {
    const content: OaiContent =
      'text' in input
        ? `${CARE_PROMPT}\n\nDOCUMENT:\n${input.text.slice(0, 8000)}`
        : [
            { type: 'image_url', image_url: { url: `data:${input.mediaType};base64,${input.imageBase64}` } },
            { type: 'text', text: CARE_PROMPT },
          ];
    return extractJson<CareExtract>(await askOpenAI(content, 2000));
  } catch (e) {
    console.warn('care extraction failed:', e);
    return null;
  }
}

export async function polishLetter(draft: string): Promise<string | null> {
  return ask(
    `Rewrite this week's elder-care observations as a short warm letter (under 150 words)
from "Dhyaan" to the family group chat about Asha's week. Plain, human, no medical
language, no bullet points, honest about anything concerning without being alarming.
Reply with only the letter text.

NOTES:
${draft.slice(0, 4000)}`,
    800,
  );
}
