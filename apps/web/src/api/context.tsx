import { createContext, use, type ReactNode } from 'react';
import type { AuthStore } from '../auth/auth';
import type { ApiClient } from './client';

export type Services = { api: ApiClient; auth: AuthStore };

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext value={value}>{children}</ServicesContext>;
}

export function useServices(): Services {
  const services = use(ServicesContext);
  if (services === null) throw new Error('ServicesProvider is missing');
  return services;
}

export function useApi(): ApiClient {
  return useServices().api;
}
