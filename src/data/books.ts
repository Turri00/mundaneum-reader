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

export async function upsertDriveBooks(category: string, entries: DriveEntry[]): Promise<BookRow[]> {
  if (!supabase) throw new Error('La connessione a Supabase non è configurata.');
  if (entries.length === 0) return [];

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('La sessione è scaduta. Accedi di nuovo.');

  const driveFileIds = entries.map((entry) => entry.id);
  const { data: currentData, error: currentError } = await supabase
    .from('books')
    .select('drive_file_id,title,author,metadata_read')
    .eq('user_id', userData.user.id)
    .in('drive_file_id', driveFileIds);
  if (currentError) throw new Error('Non è stato possibile sincronizzare i libri.');
  const existingBooks = (currentData ?? []) as Pick<BookRow, 'drive_file_id' | 'title' | 'author' | 'metadata_read'>[];
  const existingByFileId = new Map(existingBooks.map((book) => [book.drive_file_id, book]));

  const values = entries.map((entry) => {
    const existing = existingByFileId.get(entry.id);
    const fallbackTitle = entry.name.replace(/\.epub$/iu, '');
    return {
      user_id: userData.user.id,
      drive_file_id: entry.id,
      category,
      filename: entry.name,
      size_bytes: entry.size,
      title: existing?.metadata_read ? existing.title : fallbackTitle,
      author: existing?.metadata_read ? existing.author : null,
      metadata_read: existing?.metadata_read ?? false,
    };
  });

  const { data, error } = await supabase
    .from('books')
    .upsert(values, { onConflict: 'user_id,drive_file_id' })
    .select('id,user_id,drive_file_id,category,title,author,filename,size_bytes,metadata_read,created_at');
  if (error) throw new Error('Non è stato possibile salvare i libri sincronizzati.');
  return (data ?? []) as BookRow[];
}
