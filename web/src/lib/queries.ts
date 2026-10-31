import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Package, PppPlan, Router, Settings } from './types';

export const useRouters = () => useQuery({ queryKey: ['routers'], queryFn: () => api<Router[]>('/routers'), refetchInterval: 30_000 });
export const usePackages = () => useQuery({ queryKey: ['packages'], queryFn: () => api<Package[]>('/packages') });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
export const usePppPlans = () => useQuery({ queryKey: ['ppp-plans'], queryFn: () => api<PppPlan[]>('/ppp-plans') });
