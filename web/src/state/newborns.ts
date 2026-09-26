import type { NewbornRecord } from '../api/types';
import { newUUID } from '../lib/uuid';

/** Swift `NewbornRecord()` defaults + the DTO-only fields. */
export function newNewborn(): NewbornRecord {
  return {
    id: newUUID(),
    sexo: '',
    peso_gramos: null,
    talla_cm: null,
    apgar1: null,
    apgar5: null,
    apgar10: null,
    expulsion_placenta: '',
    estado_general: '',
  };
}
