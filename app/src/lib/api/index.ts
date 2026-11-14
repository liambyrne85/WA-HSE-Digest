import { createDemoApi } from './demoApi';
import { createSupabaseApi } from './supabaseApi';
import type { Api } from './types';
import { withOfflineCache } from '../offline/cache';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// In production every read is cached on the phone so the app keeps working with no coverage.
export const api: Api = url && key ? withOfflineCache(createSupabaseApi(url, key)) : createDemoApi();
export type { Api, Session, PersonInput, DemoAccount } from './types';
