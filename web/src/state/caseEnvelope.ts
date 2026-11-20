/**
 * Case envelope choices (clinician feedback 2026-11b, item 1): the surgical services
 * ("Servicio de especialidad") offered on the encounter hub. A case keeps any older free-text
 * value; the PDF prints whatever is stored.
 */
export const SERVICIOS = [
  'Cirugía general',
  'Traumatología',
  'Neurocirugía',
  'Urología',
  'Cirugía vascular',
  'Cirugía plástica y quemados',
  'Cirugía oncológica',
  'Otorrinolaringología',
  'Cirugía maxilofacial',
  'Emergencias',
] as const;
