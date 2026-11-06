/**
 * Color theme: follows the system unless the user picks light or dark.
 * The choice is stored per browser and applied as `data-theme` on <html>.
 */
import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from '../lib/storage';

export const THEME_STORAGE_KEY = 'stillwatch.theme';
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

const listeners = new Set<() => void>();

function parse(value: string | null): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function getTheme(): ThemeChoice {
  return parse(readStorage(THEME_STORAGE_KEY));
}

export function applyTheme(choice: ThemeChoice = getTheme()): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice): void {
  writeStorage(THEME_STORAGE_KEY, choice === 'system' ? null : choice);
  applyTheme(choice);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
