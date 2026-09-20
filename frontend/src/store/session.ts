// Who is signed in, who they are looking out for, and where they are in
// onboarding. The whole app is gated on `user` — no user, no screens.
//
// ponytail: in-memory only. The session survives every navigation, tab switch
// and remount for as long as the app is running, which is what a demo needs;
// a full reload signs you out, which reads as a real app locking. Ceiling:
// no token refresh, no keychain. Upgrade: persist `user`/`token` once there
// is an account system worth persisting (needs a storage dependency this
// build deliberately does not add).
import { create } from 'zustand';
import type { AuthUser, CameraZone } from '@/lib/types';

export type Role = 'family' | 'staff' | null;

/** The three separate grants of §5.4. Null = not answered yet. */
export type Grants = { falls: boolean | null; camera: boolean | null; memory: boolean | null };

/** One onboarding answer, on its way to becoming a `profile_facts` row (§4.2). */
export type FactDraft = { key: string; text: string };

export type CameraDraft = { zone: CameraZone | null; zoneHint: string };

type Session = {
  user: AuthUser | null;
  token: string | null;
  residentId: string;

  role: Role;
  onboarded: boolean;
  residentName: string;
  consentGivenBy: string;
  consentRelationship: string;
  grants: Grants;
  factDrafts: FactDraft[];
  camera: CameraDraft;

  signIn(user: AuthUser, token: string, residentId: string): void;
  /** Her real name, once the server has been asked. See `useHydrateResident`. */
  setResidentName(name: string): void;
  signOut(): void;
  setRole(r: Role): void;
  setConsent(input: {
    residentName: string; signedBy: string; relationship: string; grants: Grants;
  }): void;
  setFact(key: string, text: string): void;
  setCamera(c: Partial<CameraDraft>): void;
  finishOnboarding(): void;
  /** `Skip setup (dev)` — a signed-in session with Eleanor already set up. */
  seedDemoSession(drafts: FactDraft[]): void;
  reset(): void;
};

const emptyGrants: Grants = { falls: null, camera: null, memory: null };
const emptyCamera: CameraDraft = { zone: null, zoneHint: '' };

// ponytail: `res_eleanor` and `Eleanor` are the seed's one resident, and they
// are the value the app opens with before anyone has signed in. They are a
// placeholder, not a fact: `signIn` replaces the id with whatever
// `POST /auth/login` returns, and `useHydrateResident` replaces the name with
// what the server calls her. Ceiling: a first frame after sign-in can still
// show the placeholder name for as long as the profile request takes. Upgrade:
// return `display_name` from the login route so there is nothing to catch up.
const blank = {
  user: null,
  token: null,
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

  signIn: (user, token, residentId) => set({ user, token, residentId, role: 'family' }),

  // Only ever widens: an empty or whitespace name from the server must not
  // wipe the one already on screen.
  setResidentName: (name) => {
    const clean = name.trim();
    if (clean) set({ residentName: clean });
  },
  // Signing out drops everything, including the onboarding draft — the next
  // person to sign in on this phone must not inherit the last one's answers.
  signOut: () => set({ ...blank }),

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

  seedDemoSession: (drafts) =>
    set({
      user: { name: 'Priya Sharma', email: 'priya@dhyaan.demo' },
      token: 'demo',
      residentId: 'res_eleanor',
      role: 'family',
      onboarded: true,
      residentName: 'Eleanor',
      consentGivenBy: 'Priya Sharma',
      consentRelationship: 'Daughter',
      grants: { falls: true, camera: true, memory: true },
      factDrafts: drafts,
      camera: {
        zone: 'living_room',
        zoneHint: 'The dining table is on the left, her armchair by the window on the right.',
      },
    }),

  reset: () => set({ ...blank }),
}));
