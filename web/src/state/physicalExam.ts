/**
 * Physical exam by body system (clinician feedback 2026-11, item 2) — `pre_assessment.examen_fisico`
 * keyed by system. Each system starts collapsed; choosing Normal / Alterado opens its findings.
 * The keys and print names match `EXAM_SYSTEMS` in backend/app/infrastructure/render/crosswalk.py.
 */
import type { PreanestheticAssessment } from '../api/types';

export const EXAM_SYSTEMS = [
  { key: 'neurologico', label: 'Neurológico' },
  { key: 'cardiovascular', label: 'Cardiovascular' },
  { key: 'respiratorio', label: 'Respiratorio' },
  { key: 'gastrointestinal', label: 'Abdomen / gastrointestinal' },
  { key: 'renal', label: 'Renal / genitourinario' },
  { key: 'endocrinometabolico', label: 'Endocrinometabólico' },
  { key: 'osteomuscular', label: 'Osteomuscular' },
  { key: 'hematologico', label: 'Hematológico' },
  { key: 'tegumentos', label: 'Piel y tegumentos' },
] as const;

export const EXAM_STATES = [
  { value: 'normal', label: 'Normal' },
  { value: 'alterado', label: 'Alterado' },
] as const;
export type ExamState = (typeof EXAM_STATES)[number]['value'];

export type ExamSystem = PreanestheticAssessment['examen_fisico'][string];

/** Write one system; an entry left with no state and no findings is removed. */
export function setExam(pa: PreanestheticAssessment, key: string, patch: Partial<ExamSystem>): void {
  const next = { estado: '', hallazgos: '', ...pa.examen_fisico[key], ...patch };
  if (next.estado === '' && next.hallazgos.trim() === '') delete pa.examen_fisico[key];
  else pa.examen_fisico[key] = next;
}
