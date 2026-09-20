// TanStack Query owns anything cacheable (§10.3). Zustand owns what the socket mutates.
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSession } from '@/store/session';
import { api } from './api';

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

export const useContacts = () =>
  useQuery({ queryKey: ['contacts'], queryFn: api.getContacts });

export const useTalkAbout = () =>
  useQuery({ queryKey: ['talkAbout'], queryFn: api.talkAbout });

export const useLatestMessage = () =>
  useQuery({ queryKey: ['latestMessage'], queryFn: api.latestMessage, refetchInterval: 10_000 });

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

export const useCameraMonitor = (cameraId: string | undefined) =>
  useQuery({
    queryKey: ['monitor', cameraId],
    queryFn: () => api.getCameraMonitor(cameraId!),
    enabled: !!cameraId,
    refetchInterval: 2000,
  });

// ---- session hydration -------------------------------------------------------

/**
 * Teach the session what the server calls her.
 *
 * The store opens on a placeholder ("Eleanor", the seed's one resident) and
 * every screen that greets her by name would keep showing it for a different
 * resident. This asks the profile once the id is known and writes the real
 * name back.
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
