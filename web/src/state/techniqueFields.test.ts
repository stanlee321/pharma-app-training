import { describe, expect, it } from 'vitest';
import { techniqueZoneCompletion, techniqueZoneHasData } from './techniqueFields';

const t = (modality: string, values: Record<string, unknown>) => ({ modality, values });

describe('techniqueZoneHasData', () => {
  it('is false for an empty technique in every zone', () => {
    for (const z of ['general', 'neuraxial', 'peripheral'] as const) expect(techniqueZoneHasData(t('', {}), z)).toBe(false);
  });
  it('scopes modality to the zone that writes it', () => {
    expect(techniqueZoneHasData(t('AGIB', {}), 'general')).toBe(true);
    expect(techniqueZoneHasData(t('AGIB', {}), 'neuraxial')).toBe(false);
    expect(techniqueZoneHasData(t('Epidural', {}), 'neuraxial')).toBe(true);
    expect(techniqueZoneHasData(t('Epidural', {}), 'general')).toBe(false);
  });
  it('scopes blob keys to their zone (any key present, as Swift hasData)', () => {
    expect(techniqueZoneHasData(t('', { volatil_N2O: false }), 'general')).toBe(true);
    expect(techniqueZoneHasData(t('', { dx_morfina_val: 100 }), 'neuraxial')).toBe(true);
    expect(techniqueZoneHasData(t('', { al_Lidocaína: true }), 'peripheral')).toBe(true);
    expect(techniqueZoneHasData(t('', { al_Lidocaína: true }), 'general')).toBe(false);
  });
});

describe('techniqueZoneCompletion (Hub fallback)', () => {
  const t = (modality: string, values: Record<string, unknown>) => ({ modality, values });
  it('is all-false for an empty technique', () => {
    expect(techniqueZoneCompletion(t('', {}))).toEqual({ general: false, neuraxial: false, peripheral: false });
  });
  it('greens General for an unknown modality or an unknown blob key (Swift hasData would be green)', () => {
    expect(techniqueZoneCompletion(t('TIVA-futura', {}))).toEqual({ general: true, neuraxial: false, peripheral: false });
    expect(techniqueZoneCompletion(t('', { clave_importada: true }))).toEqual({
      general: true,
      neuraxial: false,
      peripheral: false,
    });
  });
  it('does not add General when a zone already recognises the data', () => {
    expect(techniqueZoneCompletion(t('', { nivel: 'L3–L4', clave_importada: 1 }))).toEqual({
      general: false,
      neuraxial: true,
      peripheral: false,
    });
  });
});
