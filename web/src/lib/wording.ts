import type { CaseStatus, PatientDTO, TechniqueZone, UserRole } from '../api/types';

/*
 * Shared Spanish wording (the UI is Spanish only — no i18n framework). One place for the labels
 * that appear on several screens, so they never drift apart: lifecycle states, roles, sex, the
 * case sections (named as on the paper forms), common buttons / states, and es-MX formatting.
 * Screen-specific text stays in its screen.
 */

/** Case lifecycle states. */
export const STATUS_LABELS: Record<CaseStatus, string> = { draft: 'Borrador', finalized: 'Finalizado' };

/** Account roles. */
export const ROLE_LABELS: Record<UserRole, string> = {
  anesthesiologist: 'Anestesiólogo',
  admin: 'Administrador',
};

/** The patient's `sexo` (also the case's `profile.gender` values). */
export const SEXO_LABELS: Record<PatientDTO['sexo'], string> = {
  male: 'Masculino',
  female: 'Femenino',
  '': 'Sin especificar',
};

/** Technique modality zones. */
export const TECHNIQUE_ZONE_TITLES: Record<TechniqueZone, string> = {
  general: 'General',
  neuraxial: 'Regional neuroaxial',
  peripheral: 'Bloqueo periférico',
};

/** The case's sections (Hub rows and screen titles), with the paper forms' vocabulary. */
export const SECTION_TITLES = {
  hub: 'Caso',
  patient: 'Datos del paciente',
  preanesthetic: 'Valoración preanestésica',
  technique: 'Técnica anestésica',
  monitoring: 'Registro transanestésico',
  drugs: 'Fármacos administrados',
  fluids: 'Balance de líquidos',
  recovery: 'Recuperación (Aldrete)',
  newborn: 'Recién nacido',
  review: 'Revisión y exportación',
} as const;

/** Common buttons and states. */
export const UI = {
  save: 'Guardar',
  saving: 'Guardando…',
  saveChanges: 'Guardar cambios',
  cancel: 'Cancelar',
  delete: 'Eliminar',
  deleting: 'Eliminando…',
  retry: 'Reintentar',
  close: 'Cerrar',
  dismiss: 'Descartar',
  done: 'Listo',
  loading: 'Cargando…',
  search: 'Buscar',
  clearFilters: 'Limpiar filtros',
  signIn: 'Iniciar sesión',
  signingIn: 'Iniciando sesión…',
  signOut: 'Cerrar sesión',
  changePassword: 'Cambiar contraseña',
  couldNotRefresh: 'No se pudo actualizar:',
  emptyPage: 'Esta página está vacía',
  firstPage: 'Ir a la primera página',
  filtered: ' (filtrado)',
} as const;

const esNumber = new Intl.NumberFormat('es-MX');

/** An integer / count in es-MX ("1,234"). */
export function formatCount(n: number): string {
  return esNumber.format(n);
}

/** "1 caso" / "3 casos" (counts formatted es-MX). */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "1 año" / "36 años". */
export function edadLabel(years: number): string {
  return plural(years, 'año', 'años');
}
