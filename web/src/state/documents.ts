/**
 * Stored documents: grouping for the per-case panel + the delete permission rule
 * (backend-api.md "Documents": admin always; the owner only while the case is a draft).
 */
import { formatCount } from '../lib/wording';
import type { AdminDocumentDTO, CaseStatus, DocumentDTO, FormId, UserDTO } from '../api/types';
import { FORM_OPTIONS, formTitle } from './review';

export interface DocumentGroup {
  formId: FormId;
  title: string;
  /** Newest stored version (the current one). */
  latest: DocumentDTO;
  /** Older versions, newest first. */
  older: DocumentDTO[];
}

const newestFirst = (a: DocumentDTO, b: DocumentDTO) => Date.parse(b.created_at) - Date.parse(a.created_at);

/**
 * Group documents by form in the known form order (never the server's order), each group
 * newest first. Forms without documents are left out; unknown form ids go last.
 */
export function groupDocuments(docs: readonly DocumentDTO[]): DocumentGroup[] {
  const known = FORM_OPTIONS.map((f) => f.id as string);
  const byForm = new Map<string, DocumentDTO[]>();
  for (const d of docs) {
    const list = byForm.get(d.form_id) ?? [];
    list.push(d);
    byForm.set(d.form_id, list);
  }
  const order = [...known, ...[...byForm.keys()].filter((k) => !known.includes(k)).sort()];
  const groups: DocumentGroup[] = [];
  for (const formId of order) {
    const list = byForm.get(formId);
    if (!list?.length) continue;
    const [latest, ...older] = [...list].sort(newestFirst);
    groups.push({ formId: formId as FormId, title: formTitle(formId as FormId), latest: latest!, older });
  }
  return groups;
}

/** Who may delete a stored document: an admin, or the case owner while the case is a draft. */
export function canDeleteDocuments(user: Pick<UserDTO, 'role'> | null, status: CaseStatus): boolean {
  if (!user) return false;
  return user.role === 'admin' || status === 'draft';
}

/** Local file name for a downloaded document. */
export function documentFileName(d: Pick<DocumentDTO, 'form_id' | 'case_id' | 'created_at'>): string {
  const stamp = d.created_at.replace(/[^0-9]/g, '').slice(0, 14);
  return `${d.form_id}_${d.case_id.slice(0, 8)}_${stamp}.pdf`;
}

/** "201 KB" (at least 1 KB). */
export function formatSize(bytes: number): string {
  return `${formatCount(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

type StorageFields = Pick<AdminDocumentDTO, 'storage_path'> & { storage_backend?: string };

/**
 * Where the bytes live (admin-only). `local` storage: the file's base name ("Local file · x.pdf"),
 * with the full server path only in `title` (a tooltip), so the host layout / OS user is not
 * printed in the table. `db` storage: `storage_path` is null → "Stored in the database". Older
 * servers send only `storage_path` (treated as a local file).
 */
export function storageInfo(d: StorageFields): { label: string; title: string } {
  const path = d.storage_path?.trim();
  if (path && (d.storage_backend === undefined || d.storage_backend === 'local')) {
    const base = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    return { label: `Archivo local · ${base}`, title: path };
  }
  if (d.storage_backend === 'db') return { label: 'En la base de datos', title: 'Guardado en la base de datos' };
  if (d.storage_backend) {
    const label = `Almacenamiento: ${d.storage_backend}`;
    return { label, title: path ? `${label} (${path})` : label };
  }
  return { label: '—', title: 'Almacenamiento desconocido' };
}

/** The table text of `storageInfo`. */
export function storageLabel(d: StorageFields): string {
  return storageInfo(d).label;
}
