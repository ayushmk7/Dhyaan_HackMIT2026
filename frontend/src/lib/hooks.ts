// TanStack Query owns anything cacheable (§10.3). Zustand owns what the socket mutates.
import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSession } from '@/store/session';
import { api } from './api';

/**
 * A clock the screen can read without calling `Date.now()` mid-render, which
 * the compiler's purity rule forbids and which would go stale in place anyway.
 * One interval, one number, and everything derived from "is this still true?"
 * hangs off it. Lived in the camera console until Today and the alert takeover
 * needed the same question asked of their own data.
 */
export function useNow(everyMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // A screen the phone is not showing does not need a clock. The tab stays
    // mounted when you leave it, so without this the camera console kept
    // ticking once a second in your pocket.
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs, enabled]);
  return now;
}

export const useResidents = () =>
  useQuery({ queryKey: ['residents'], queryFn: api.listResidents });

export const useResident = (id: string) =>
  useQuery({ queryKey: ['resident', id], queryFn: () => api.getResident(id), enabled: !!id });

export const useTimeline = (residentId: string) =>
  useQuery({ queryKey: ['events', residentId], queryFn: () => api.getEvents(residentId) });

export const useEvent = (id: string) =>
  useQuery({ queryKey: ['event', id], queryFn: () => api.getEvent(id), enabled: !!id });

export const useSummaries = (residentId: string) =>
  useQuery({ queryKey: ['summaries', residentId], queryFn: () => api.getSummaries(residentId) });

export const useLocationHistory = (residentId: string, date: string) =>
  useQuery({
    queryKey: ['loc', residentId, date],
    queryFn: () => api.getLocationHistory(residentId, date),
    enabled: !!date,
  });

export const useBaselines = (residentId: string) =>
  useQuery({ queryKey: ['baselines', residentId], queryFn: () => api.getBaselines(residentId) });

// All three read the session's resident inside `api` (http.ts: `residentId()`),
// so the cache must be keyed by it too. Unkeyed, the takeover for a resident
// this phone has switched to named the previous one's contact.
export const useContacts = () => {
  const residentId = useSession((s) => s.residentId);
  return useQuery({ queryKey: ['contacts', residentId], queryFn: api.getContacts });
};

export const useTalkAbout = () => {
  const residentId = useSession((s) => s.residentId);
  return useQuery({ queryKey: ['talkAbout', residentId], queryFn: api.talkAbout });
};

export const useLatestMessage = () => {
  const residentId = useSession((s) => s.residentId);
  return useQuery({
    queryKey: ['latestMessage', residentId],
    queryFn: api.latestMessage,
    refetchInterval: 10_000,
  });
};

export const useAlert = (id: string) =>
  useQuery({
    queryKey: ['alert', id],
    queryFn: () => api.getAlert(id),
    enabled: !!id,
    refetchInterval: 3000, // belt-and-braces under the websocket
  });

// ---- camera lane -------------------------------------------------------------
// Presence is pushed over the websocket (`presence.update`); the 15 s refetch
// is the belt-and-braces under it, the same trick useAlert already uses. Local
// day key, because "today" is her day, not UTC's.

export const localDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const usePresence = (residentId: string) =>
  useQuery({
    queryKey: ['presence', residentId],
    queryFn: () => api.getPresence(residentId),
    enabled: !!residentId,
    refetchInterval: 15_000,
  });

export const useActivity = (residentId: string, date = localDayKey()) =>
  useQuery({
    queryKey: ['activity', residentId, date],
    queryFn: () => api.getActivity(residentId, date),
    enabled: !!residentId && !!date,
    refetchInterval: 30_000,
  });

export const useProfile = (residentId: string) =>
  useQuery({
    queryKey: ['profile', residentId],
    queryFn: () => api.getProfile(residentId),
    enabled: !!residentId,
  });

// ---- the camera console ------------------------------------------------------
// The tick arrives over the websocket (`camera.monitor`); this poll is the belt
// under it, and the only way to see anything at all if the socket is down. 2 s,
// because a console that updates once a minute does not read as live.

export const useCameras = () =>
  useQuery({ queryKey: ['cameras'], queryFn: api.listCameras });

// Only the camera console reads this, and only while you are looking at it:
// a 2 s poll that survives leaving the tab is a battery leak, not telemetry.
export const useCameraMonitor = (cameraId: string | undefined) => {
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['monitor', cameraId],
    queryFn: () => api.getCameraMonitor(cameraId!),
    enabled: !!cameraId && focused,
    refetchInterval: 2000,
  });
};

/**
 * Which room the beacons put her in. Room level, never a position: the ESP32s
 * report RSSI and `app/location.py` classifies it against the survey, so the
 * answer is a room name and a confidence and nothing finer.
 *
 * Only the camera console calls this. It is the screen whose job is to show
 * what the system is working from, and the room is the one reading it has that
 * does not come from the camera at all.
 */
export const useResidentLocation = (residentId: string | undefined) => {
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['location', residentId],
    queryFn: () => api.getLocation(residentId!),
    enabled: !!residentId && focused,
    refetchInterval: 5000,
  });
};

// ---- session hydration -------------------------------------------------------

/**
 * Teach the session what the server calls her.
 *
 * The store opens with no name at all, because shipping one meant the app
 * greeted whoever the seed happened to be called. This asks the profile as
 * soon as the resident id is known and writes the real name back.
 *
 * Mounted once, high in the tree. It renders nothing and returns nothing: a
 * screen should read `residentName` from the session, not from here.
 */
export function useHydrateResident(): void {
  const residentId = useSession((s) => s.residentId);
  const setResidentName = useSession((s) => s.setResidentName);
  const { data } = useQuery({
    queryKey: ['profile', residentId],
    queryFn: () => api.getProfile(residentId),
    enabled: !!residentId,
  });
  useEffect(() => {
    if (data?.name) setResidentName(data.name);
  }, [data?.name, setResidentName]);
}
