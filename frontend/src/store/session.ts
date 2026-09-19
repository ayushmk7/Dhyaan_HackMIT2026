// Who is using the app and where they are in onboarding. In-memory for the demo;
// ponytail: persistence ceiling — add AsyncStorage when accounts are real.
import { create } from 'zustand';

export type Role = 'family' | 'staff' | null;

type Baseline = {
  wake: string; mealsPerDay: number; walksPerDay: number; goesOutside: boolean; mobility: string;
};

type Session = {
  role: Role;
  onboarded: boolean;
  residentName: string;
  consentGivenBy: string;
  baseline: Baseline;
  setRole(r: Role): void;
  setConsent(residentName: string, by: string): void;
  setBaseline(b: Partial<Baseline>): void;
  finishOnboarding(): void;
  reset(): void;
};

const initialBaseline: Baseline = {
  wake: '6:30', mealsPerDay: 3, walksPerDay: 2, goesOutside: true, mobility: 'Steady on her feet',
};

export const useSession = create<Session>((set) => ({
  role: null,
  onboarded: false,
  residentName: 'Eleanor',
  consentGivenBy: '',
  baseline: initialBaseline,
  setRole: (role) => set({ role, onboarded: role === 'staff' }),
  setConsent: (residentName, consentGivenBy) => set({ residentName, consentGivenBy }),
  setBaseline: (b) => set((s) => ({ baseline: { ...s.baseline, ...b } })),
  finishOnboarding: () => set({ onboarded: true }),
  reset: () => set({ role: null, onboarded: false, consentGivenBy: '', baseline: initialBaseline }),
}));
