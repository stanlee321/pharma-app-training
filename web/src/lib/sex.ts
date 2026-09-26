/**
 * The ONE place that decides a patient's sex from the wire `PatientProfileDTO.gender` (a free
 * string; every client writes "male" | "female", the DTO default is "male"). Used by the PK
 * engine (James LBM), the biometrics (peso ideal), the Patient Data sex chips and Review.
 *
 * Only "female" (case/whitespace-insensitive) is female; anything else, including an empty or
 * unknown value, is treated as male — the DTO default.
 */
export function isFemale(gender: string | null | undefined): boolean {
  return (gender ?? '').trim().toLowerCase() === 'female';
}
