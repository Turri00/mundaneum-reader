import { supabase } from './supabase';
import type { DriveEntry } from './driveProxy';

export interface BookRow {
  id: string;
  user_id: string;
  drive_file_id: string;
  category: string | null;
  title: string | null;
  author: string | null;
  filename: string;
  size_bytes: number | null;
  metadata_read: boolean;
  created_at: string;
}

export async function getBooks(category: string): Promise<BookRow[]> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  const { data, error } = await supabase
    .from('books')
    .select('id,user_id,drive_file_id,category,title,author,filename,size_bytes,metadata_read,created_at')
    .eq('category', category)
    .order('title', { ascending: true });
  if (error) throw new Error('Non è stato possibile caricare i libri salvati.');
  return (data ?? []) as BookRow[];
}

export async function updateBookMetadata(bookId: string, title: string, author: string | null): Promise<void> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  const { data, error } = await supabase
    .from('books')
    .update({ title, author, metadata_read: true })
    .eq('id', bookId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    const code = error ? ` (${error.code})` : '';
    throw new Error(`Non è stato possibile salvare i metadati del libro${code}.`);
  }
}

export async function upsertDriveBooks(category: string, entries: DriveEntry[]): Promise<BookRow[]> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  if (entries.length === 0) return getBooks(category);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('La sessione è scaduta. Accedi di nuovo.');

  const driveFileIds = entries.map((entry) => entry.id);
  const { data: currentData, error: currentError } = await supabase
    .from('books')
    .select('drive_file_id')
    .eq('user_id', userData.user.id)
    .in('drive_file_id', driveFileIds);
  if (currentError) throw new Error('Non è stato possibile sincronizzare i libri.');
  const existingIds = new Set((currentData ?? []).map((book) => book.drive_file_id as string));
  const existingEntries = entries.filter((entry) => existingIds.has(entry.id));
  const newEntries = entries.filter((entry) => !existingIds.has(entry.id));

  if (existingEntries.length > 0) {
    for (const entry of existingEntries) {
      const { data: updatedBook, error: updateError } = await supabase
        .from('books')
        .update({ category, filename: entry.name, size_bytes: entry.size })
        .eq('user_id', userData.user.id)
        .eq('drive_file_id', entry.id)
        .select('drive_file_id')
        .maybeSingle();
      if (updateError || !updatedBook) {
        throw new Error('Non è stato possibile aggiornare i libri sincronizzati: verifica le policy RLS.');
      }
    }
  }

  if (newEntries.length > 0) {
    const values = newEntries.map((entry) => ({
      user_id: userData.user.id,
      drive_file_id: entry.id,
      category,
      filename: entry.name,
      size_bytes: entry.size,
    }));
    const { error } = await supabase
      .from('books')
      .upsert(values, { onConflict: 'user_id,drive_file_id', ignoreDuplicates: true });
    if (error) throw new Error('Non è stato possibile salvare i nuovi libri sincronizzati.');
  }

  return getBooks(category);
}
