import { supabase } from './supabase';

export interface ProgressRow {
  book_id: string;
  user_id: string;
  cfi: string;
  percentage: number;
  device_id: string;
  updated_at: string;
}

export interface ProgressUpdate {
  bookId: string;
  cfi: string;
  percentage: number;
  deviceId: string;
}

export async function getProgress(bookId: string): Promise<ProgressRow | null> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  const { data, error } = await supabase
    .from('progress')
    .select('book_id,user_id,cfi,percentage,device_id,updated_at')
    .eq('book_id', bookId)
    .maybeSingle();
  if (error) throw new Error('Non è stato possibile caricare il progresso.');
  return data as ProgressRow | null;
}

export async function getProgressForBooks(bookIds: string[]): Promise<ProgressRow[]> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  if (bookIds.length === 0) return [];
  const { data, error } = await supabase
    .from('progress')
    .select('book_id,user_id,cfi,percentage,device_id,updated_at')
    .in('book_id', bookIds);
  if (error) throw new Error('Non è stato possibile caricare le percentuali di lettura.');
  return (data ?? []) as ProgressRow[];
}

export async function saveProgress(update: ProgressUpdate): Promise<string> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  const { data, error } = await supabase.from('progress').upsert({
      book_id: update.bookId,
      cfi: update.cfi,
      percentage: Math.max(0, Math.min(1, update.percentage)),
      device_id: update.deviceId,
    }, { onConflict: 'book_id' })
    .select('updated_at')
    .single();
  if (error || !data) throw new Error('Non è stato possibile salvare il progresso sul cloud.');
  return (data as { updated_at: string }).updated_at;
}
