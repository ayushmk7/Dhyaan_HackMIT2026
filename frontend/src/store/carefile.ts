// Her care file — the paper folder every family carries, held by the caregiver.
// Client-side for the demo (zustand, like session); documents are explicitly
// handed to Dhyaan by the family — it never reaches into their content itself.
// ponytail: persistence + a backend /carefile endpoint are the upgrade path.
import { create } from 'zustand';
import { extractCareInfo, hasAI, type CareExtract } from '@/lib/ai';
import { EXAMPLE_DISCHARGE, EXAMPLE_EXTRACT } from '@/lib/example-docs';

export interface CareSource {
  id: string;
  kind: 'paste' | 'photo';
  added_at: string;
  summary: string;
}

type CareFile = {
  medications: CareExtract['medications'];
  appointments: CareExtract['appointments'];
  emergency: CareExtract['emergency'];
  sources: CareSource[];
};

type CareFileStore = CareFile & {
  busy: boolean;
  addDocument(input: { text?: string; imageBase64?: string; mediaType?: string }): Promise<
    { added: string } | { error: string }
  >;
};

const empty: CareFile = {
  medications: [],
  appointments: [],
  emergency: { allergies: [], conditions: [] },
  sources: [],
};

const dedupe = <T>(items: T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export const useCareFile = create<CareFileStore>((set, get) => ({
  ...empty,
  busy: false,

  async addDocument(input) {
    set({ busy: true });
    try {
      let extract: CareExtract | null = null;
      if (input.text) {
        extract = await extractCareInfo({ text: input.text });
        // Keyless demo path: the example document parses to its known contents.
        if (!extract && !hasAI && input.text.trim() === EXAMPLE_DISCHARGE.trim()) {
          extract = EXAMPLE_EXTRACT;
        }
      } else if (input.imageBase64 && input.mediaType) {
        extract = await extractCareInfo({
          imageBase64: input.imageBase64,
          mediaType: input.mediaType,
        });
      }
      if (!extract) {
        return {
          error: hasAI
            ? 'Couldn’t read that as a care document — try a clearer copy.'
            : 'Live reading needs the AI key — the example document works without it.',
        };
      }

      const s = get();
      set({
        medications: dedupe([...s.medications, ...extract.medications], (m) => m.name),
        appointments: dedupe(
          [...s.appointments, ...extract.appointments],
          (a) => `${a.title}|${a.when}`,
        ),
        emergency: {
          allergies: dedupe([...s.emergency.allergies, ...extract.emergency.allergies], (x) => x),
          conditions: dedupe(
            [...s.emergency.conditions, ...extract.emergency.conditions],
            (x) => x,
          ),
          doctor: extract.emergency.doctor ?? s.emergency.doctor,
        },
        sources: [
          {
            id: `src_${Date.now().toString(36)}`,
            kind: input.text ? 'paste' : 'photo',
            added_at: new Date().toISOString(),
            summary: extract.summary,
          },
          ...s.sources,
        ],
      });
      return { added: extract.summary };
    } finally {
      set({ busy: false });
    }
  },
}));

// One line for the alert takeover's EMS card; null when there's nothing to say.
export const emergencyLine = (f: Pick<CareFile, 'medications' | 'emergency'>): string | null => {
  const parts: string[] = [];
  if (f.emergency.allergies.length) parts.push(`Allergic to ${f.emergency.allergies.join(', ')}`);
  if (f.medications.length) parts.push(`On ${f.medications.map((m) => m.name).join(', ')}`);
  if (f.emergency.conditions.length) parts.push(f.emergency.conditions.join(', '));
  if (f.emergency.doctor) {
    parts.push(`${f.emergency.doctor.name}${f.emergency.doctor.phone ? ` · ${f.emergency.doctor.phone}` : ''}`);
  }
  return parts.length ? parts.join(' — ') : null;
};
