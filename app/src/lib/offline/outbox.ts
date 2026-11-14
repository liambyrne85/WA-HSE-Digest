// Outbox: records made with no coverage wait here (with their photos) and are sent
// in order when the phone is back online. Nothing is ever dropped silently — an item
// the server rejects stays here with the reason until the person deals with it.
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RecordInput } from '../api/types';
import type { ScaffoldInspectionInput } from '../types';
import { kvGet, kvSet } from './kv';
import { isNetworkError, isOnline } from './net';

export type OutboxKind = 'scaffold_inspection' | 'record';
export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** shown in the sync list, e.g. "Inspection · SCF-PHW-0001" */
  label: string;
  user_id: string;
  payload: ScaffoldInspectionInput | RecordInput;
  /** link to open once synced, e.g. /scaffolds/{id} */
  link?: string;
  scaffold_id?: string;
  created_at: string;
  attempts: number;
  error?: string;
}

const KEY = 'outbox';
const listeners = new Set<() => void>();
let syncing = false;
const notify = () => listeners.forEach((l) => l());

export async function outboxItems(): Promise<OutboxItem[]> {
  return (await kvGet<OutboxItem[]>(KEY)) ?? [];
}
async function write(items: OutboxItem[]) {
  await kvSet(KEY, items);
  notify();
}
export async function removeOutboxItem(id: string) {
  await write((await outboxItems()).filter((i) => i.id !== id));
}

async function send(item: OutboxItem) {
  if (item.kind === 'scaffold_inspection') return api.submitScaffoldInspection(item.payload as ScaffoldInspectionInput);
  return api.saveRecord(item.payload as RecordInput);
}

/** Send now if there's coverage; otherwise (or if the connection drops) keep it on the phone. */
export async function submitOrQueue<T>(item: Omit<OutboxItem, 'created_at' | 'attempts' | 'user_id'>): Promise<{ queued: boolean; result?: T }> {
  const session = await api.getSession();
  if (isOnline()) {
    try {
      return { queued: false, result: (await send({ ...item, user_id: session?.userId ?? '', created_at: '', attempts: 0 })) as T };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  await write([...(await outboxItems()), { ...item, user_id: session?.userId ?? '', created_at: new Date().toISOString(), attempts: 0 }]);
  return { queued: true };
}

/** Send everything waiting for the signed-in person, oldest first. */
export async function flushOutbox() {
  if (syncing || !isOnline()) return;
  syncing = true;
  notify();
  try {
    const session = await api.getSession();
    if (!session) return;
    for (const item of await outboxItems()) {
      if (item.user_id !== session.userId) continue; // only ever send as the person who made it
      try {
        await send(item);
        await write((await outboxItems()).filter((i) => i.id !== item.id));
      } catch (e) {
        if (isNetworkError(e)) break;
        await write((await outboxItems()).map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1, error: e instanceof Error ? e.message : String(e) } : i)));
      }
    }
  } finally {
    syncing = false;
    notify();
  }
}

let started = false;
export function startOutbox() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void flushOutbox());
  setInterval(() => void flushOutbox(), 60000);
  void flushOutbox();
}

export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(isOnline());
  useEffect(() => {
    let alive = true;
    const refresh = () => { void outboxItems().then((x) => alive && setItems(x)); setBusy(syncing); };
    listeners.add(refresh);
    const on = () => { setOnline(isOnline()); refresh(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    refresh();
    return () => { alive = false; listeners.delete(refresh); window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  return { items, syncing: busy, online, flush: flushOutbox, remove: removeOutboxItem };
}
