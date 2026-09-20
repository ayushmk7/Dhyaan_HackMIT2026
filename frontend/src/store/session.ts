// Who this phone is looking out for, and where it is in onboarding. There is
// no signed-in person: the app has no login and the backend has no auth (see
// backend/app/main.py). Nothing here is a credential.
//
// ponytail: in-memory only. The session survives every navigation, tab switch
// and remount for as long as the app is running, which is what a demo needs;
// a full reload starts onboarding again. Upgrade: persist this once there is
// something worth persisting (needs a storage dependency this build
// deliberately does not add).
import { create } from 'zustand';
import type { CameraZone } from '@/lib/types';

export type Role = 'family' | 'staff' | null;

/** The three separate grants of §5.4. Null = not answered yet. */
export type Grants = { falls: boolean | null; camera: boolean | null; memory: boolean | null };

/** One onboarding answer, on its way to becoming a `profile_facts` row (§4.2). */
export type FactDraft = { key: string; text: string };

export type CameraDraft = { zone: CameraZone | null; zoneHint: string };

type Session = {
  residentId: string;

  role: Role;
  onboarded: boolean;
  residentName: string;
  consentGivenBy: string;
  consentRelationship: string;
  grants: Grants;
  factDrafts: FactDraft[];
  camera: CameraDraft;

  /** Her real name, once the server has been asked. See `useHydrateResident`. */
  setResidentName(name: string): void;
  setRole(r: Role): void;
  setConsent(input: {
    residentName: string; signedBy: string; relationship: string; grants: Grants;
  }): void;
  setFact(key: string, text: string): void;
  setCamera(c: Partial<CameraDraft>): void;
  finishOnboarding(): void;
  /** `Skip setup (dev)` — a session with Eleanor already set up. */
  seedDemoSession(drafts: FactDraft[]): void;
  /** Drops everything, including the onboarding draft. */
  reset(): void;
};

const emptyGrants: Grants = { falls: null, camera: null, memory: null };
const emptyCamera: CameraDraft = { zone: null, zoneHint: '' };

// ponytail: `res_eleanor` and `Eleanor` are the seed's one resident, and they
// are the value the app opens with. The name is a placeholder, not a fact:
// `useHydrateResident` replaces it with what the server calls her. Ceiling: a
// first frame can still show the placeholder name for as long as the profile
// request takes.
const blank = {
  residentId: 'res_eleanor',
  role: null as Role,
  onboarded: false,
  residentName: 'Eleanor',
  consentGivenBy: '',
  consentRelationship: '',
  grants: emptyGrants,
  factDrafts: [] as FactDraft[],
  camera: emptyCamera,
};

export const useSession = create<Session>((set) => ({
  ...blank,

  // Only ever widens: an empty or whitespace name from the server must not
  // wipe the one already on screen.
  setResidentName: (name) => {
    const clean = name.trim();
    if (clean) set({ residentName: clean });
  },
  setRole: (role) => set({ role, onboarded: role === 'staff' }),

  setConsent: ({ residentName, signedBy, relationship, grants }) =>
    set({
      residentName,
      consentGivenBy: signedBy,
      consentRelationship: relationship,
      grants,
    }),

  setFact: (key, text) =>
    set((s) => ({
      factDrafts: [...s.factDrafts.filter((f) => f.key !== key), { key, text }],
    })),

  setCamera: (c) => set((s) => ({ camera: { ...s.camera, ...c } })),

  finishOnboarding: () => set({ onboarded: true }),

  // Only what skipping setup needs: the lane, the flag, the seed's one
  // resident id. It names nobody. Who signed consent, her name and her camera
  // all come from the server (`useHydrateResident`, `GET /profile`); against
  // a live backend this used to show an invented signer until that loaded.
  seedDemoSession: (drafts) =>
    set({
      residentId: 'res_eleanor',
      role: 'family',
      onboarded: true,
      factDrafts: drafts,
    }),

  reset: () => set({ ...blank }),
}));
