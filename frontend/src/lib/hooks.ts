// TanStack Query owns anything cacheable (§10.3). Zustand owns what the socket mutates.
import { useQuery } from '@tanstack/react-query';
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

export const useAlert = (id: string) =>
  useQuery({
    queryKey: ['alert', id],
    queryFn: () => api.getAlert(id),
    enabled: !!id,
    refetchInterval: 3000, // belt-and-braces under the websocket
  });
