import { normalizeCase } from './factory';
import { http as appHttp, type HttpClient } from './http';
import type {
  AdminCasePage,
  AdminDocumentPage,
  AdminStatsDTO,
  AdminUserCreate,
  AdminUserUpdate,
  AnesthesiaCase,
  AnesthesiaCaseDTO,
  CaseStatus,
  FormId,
  UserDTO,
  UserRole,
} from './types';

/** Filters of `GET /admin/users` (`q` = substring of username, full name or clave). */
export interface UserFilters {
  q?: string;
  role?: UserRole | '';
  /** '' = any. */
  is_active?: boolean | '';
}

/** Filters + paging of `GET /admin/cases` (dates are inclusive UTC days, `YYYY-MM-DD`). */
export interface CaseFilters {
  status?: CaseStatus | '';
  user_id?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

/** Filters + paging of `GET /admin/documents` (`case_id` must be a UUID, else the server 422s). */
export interface DocumentFilters {
  case_id?: string;
  form_id?: FormId | '';
  limit?: number;
  offset?: number;
}

/**
 * The `/admin` API (admins only; the server answers 403 "admin only" to anyone else). Every call
 * goes through the one authenticated HTTP layer, so errors are `BackendError`s whose `.detail`
 * is the server's message (e.g. the 409 user guards).
 */
export class AdminApi {
  constructor(private readonly http: HttpClient = appHttp) {}

  stats(): Promise<AdminStatsDTO> {
    return this.http.json<AdminStatsDTO>('GET', ['admin', 'stats']);
  }

  listUsers(f: UserFilters = {}): Promise<UserDTO[]> {
    return this.http.json<UserDTO[]>('GET', ['admin', 'users'], {
      query: { q: f.q?.trim(), role: f.role, is_active: f.is_active },
    });
  }

  getUser(id: string): Promise<UserDTO> {
    return this.http.json<UserDTO>('GET', ['admin', 'users', id]);
  }

  /** → the new account (`must_change_password = true`; `password` is temporary). */
  createUser(body: AdminUserCreate): Promise<UserDTO> {
    return this.http.json<UserDTO>('POST', ['admin', 'users'], { body });
  }

  /** Only the keys present are applied. */
  updateUser(id: string, patch: AdminUserUpdate): Promise<UserDTO> {
    return this.http.json<UserDTO>('PATCH', ['admin', 'users', id], { body: patch });
  }

  /** 204: sets a new temporary password, forces a change at next login, revokes their tokens. */
  resetPassword(id: string, password: string): Promise<void> {
    return this.http.send('POST', ['admin', 'users', id, 'reset-password'], { body: { password } });
  }

  /** 204; 409 when the user owns cases (deactivate instead), for yourself, or the last admin. */
  deleteUser(id: string): Promise<void> {
    return this.http.send('DELETE', ['admin', 'users', id]);
  }

  /** Every case, newest first; `total` is the filtered count before paging. */
  listCases(f: CaseFilters = {}): Promise<AdminCasePage> {
    return this.http.json<AdminCasePage>('GET', ['admin', 'cases'], {
      query: {
        status: f.status,
        user_id: f.user_id,
        q: f.q?.trim(),
        date_from: f.date_from,
        date_to: f.date_to,
        limit: f.limit,
        offset: f.offset,
      },
    });
  }

  /** The full aggregate (read-only for an admin). */
  async getCase(id: string): Promise<AnesthesiaCase> {
    return normalizeCase(await this.http.json<AnesthesiaCaseDTO>('GET', ['admin', 'cases', id]));
  }

  /** 204, any status; the server also deletes the case's document rows and files. */
  deleteCase(id: string): Promise<void> {
    return this.http.send('DELETE', ['admin', 'cases', id]);
  }

  /** finalized → draft (documents kept); a draft → 409 "case is not finalized". */
  async reopenCase(id: string): Promise<AnesthesiaCase> {
    return normalizeCase(await this.http.json<AnesthesiaCaseDTO>('POST', ['admin', 'cases', id, 'reopen']));
  }

  /** Every stored document, newest first. */
  listDocuments(f: DocumentFilters = {}): Promise<AdminDocumentPage> {
    return this.http.json<AdminDocumentPage>('GET', ['admin', 'documents'], {
      query: { case_id: f.case_id?.trim(), form_id: f.form_id, limit: f.limit, offset: f.offset },
    });
  }

  /** A stored PDF through the authenticated layer (never a bare link: it would lack the token). */
  documentFile(id: string): Promise<Blob> {
    return this.http.blob('GET', ['documents', id, 'file']);
  }
}

/** The app-wide admin API. */
export const adminApi = new AdminApi();
