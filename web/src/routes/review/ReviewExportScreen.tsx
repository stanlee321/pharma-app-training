import { useState } from 'react';
import type { AnesthesiaCase } from '../../api/types';
import { Section } from '../../components/Section';
import { imc } from '../../lib/biometrics';
import { isFemale } from '../../lib/sex';
import { useAuthStore } from '../../state/authStore';
import { aldreteTotals, caseAsa, display, romanASA } from '../../state/review';
import { CaseScreen } from '../CaseScreen';
import { DocumentsPanel } from '../documents/DocumentsPanel';
import { FinalizeSection } from './FinalizeSection';
import './review.css';

/**
 * N10 — Review & Export (Swift ReviewExportScreen): a read-only projection of the case (patient,
 * diagnosis, technique, Aldrete column totals), then the case lifecycle and its documents:
 * - Finalize (owner, draft): in-page confirmation → `POST /cases/{id}/finalize`, which locks the
 *   case and stores the 4 forms; the documents panel then lists them.
 * - Documents (`DocumentsPanel`): "Generate & store" (`POST /cases/{id}/documents`, a dirty draft
 *   is saved first) replaces the old stream-only export; the newest document is previewed inline
 *   from an authenticated blob URL. Swift's "Offline summary" is not ported.
 */
export function ReviewExportScreen() {
  const role = useAuthStore((s) => s.user?.role);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <CaseScreen
      title="Review & Export"
      aside={(c) => (
        <>
          {role === 'admin' ? null : <FinalizeSection c={c} onFinalized={() => setReloadKey((k) => k + 1)} />}
          <DocumentsPanel caseId={c.id} status={c.status} reloadKey={reloadKey} />
        </>
      )}
    >
      {(c) => <ReviewForm c={c} />}
    </CaseScreen>
  );
}

function ReviewForm({ c }: { c: AnesthesiaCase }) {
  const p = c.patient.profile;
  const asa = caseAsa(c);
  const totals = aldreteTotals(c.recovery);

  return (
    <>
      <Section header="Paciente">
        <SummaryRow label="Nombre" value={display(c.patient.nombre)} />
        <SummaryRow label="Registro" value={display(c.patient.registro)} />
        <SummaryRow label="Edad" value={`${Math.trunc(p.age)} años`} />
        <SummaryRow label="Sexo" value={isFemale(p.gender) ? 'F' : 'M'} />
        <SummaryRow label="Peso / Talla" value={`${p.weight.toFixed(0)} kg · ${p.height.toFixed(0)} cm`} />
        <SummaryRow label="IMC" value={imc(p).toFixed(1)} />
      </Section>

      <Section header="Diagnóstico">
        <SummaryRow label="Preoperatorio" value={display(c.diagnostico_preop)} />
        <SummaryRow label="Postoperatorio" value={display(c.diagnostico_postop)} />
        <SummaryRow label="Operación" value={display(c.operacion_propuesta)} />
        <SummaryRow label="ASA" value={asa == null ? '—' : romanASA(asa)} />
      </Section>

      <Section header="Técnica anestésica">
        <SummaryRow label="Modalidad" value={display(c.technique.modality)} />
        <SummaryRow label="Fármacos registrados" value={String(c.drugs.length)} />
      </Section>

      <Section header="Aldrete (recovery)">
        {totals.length === 0 ? (
          <div className="row review-empty">No Aldrete score recorded</div>
        ) : (
          totals.map((col) => <SummaryRow key={col.point} label={col.point} value={`${col.total} / 10`} />)
        )}
      </Section>

    </>
  );
}

/** Swift `RE_SummaryRow`: a read-only label + value row. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row review-row">
      <span className="row__label">{label}</span>
      <span className="review-row__value">{value}</span>
    </div>
  );
}
