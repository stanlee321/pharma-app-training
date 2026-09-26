import { SECTION_TITLES } from '../lib/wording';
import { caseTitle } from '../api/factory';
import { TECHNIQUE_ZONES, TECHNIQUE_ZONE_TITLES } from '../api/types';
import type { IconName } from '../components/Icon';
import { TextRow } from '../components/FormRows';
import { Section } from '../components/Section';
import { SectionLinkRow } from '../components/SectionLinkRow';
import { sectionCompletion } from '../state/completion';
import { techniqueZoneCompletion } from '../state/techniqueFields';
import type { ReactNode } from 'react';
import type { AnesthesiaCase } from '../api/types';
import { useCaseScope } from '../state/caseScope';
import { CaseScreen } from './CaseScreen';

/**
 * N2 — Encounter Hub (Swift EncounterHubView): the case root envelope + section rows that push
 * into each sub-screen. Rows read blue while empty and green with a check once they hold data.
 * Title is the case title (inline); back returns to the case's patient (owner scope), else to the
 * scope's list. Unsaved edits are PUT on
 * Save and when the Hub is left (Swift `.onDisappear { store.save }`).
 *
 * Deviation: Swift has ONE "Anesthetic Technique" row (always opening the General zone); the web
 * Hub lists the three technique zones as separate rows so Neuraxial / Peripheral are reachable,
 * each with its own completion flag (`techniqueZoneCompletion`: per-zone keys, falling back to
 * General when the technique has data no zone recognises, so it never reads as undocumented).
 *
 * The links follow the case scope (`/cases/…` for the owner, `/admin/cases/…` for an admin's
 * read-only view); `aside` adds non-case content (the admin's actions and documents).
 */
export function EncounterHubView({ aside }: { aside?: (c: AnesthesiaCase) => ReactNode } = {}) {
  const { paths, list, patient } = useCaseScope();
  return (
    <CaseScreen
      title={caseTitle}
      back={(_id, c) => (c?.patient_id && patient ? patient(c.patient_id) : list)}
      aside={aside}
    >
      {(c, update) => {
        const done = sectionCompletion(c);
        const zoneDone = techniqueZoneCompletion(c.technique);
        const id = c.id;
        const rows: { title: string; to: string; icon: IconName; filled: boolean }[] = [
          { title: SECTION_TITLES.patient, to: paths.patient(id), icon: 'person', filled: done.patient },
          {
            title: SECTION_TITLES.preanesthetic,
            to: paths.preanesthetic(id),
            icon: 'clipboard',
            filled: done.preanesthetic,
          },
          ...TECHNIQUE_ZONES.map((z) => ({
            title: `${SECTION_TITLES.technique} · ${TECHNIQUE_ZONE_TITLES[z]}`,
            to: paths.technique(id, z),
            icon: 'waveform' as const,
            filled: zoneDone[z],
          })),
          {
            title: SECTION_TITLES.monitoring,
            to: paths.monitoring(id),
            icon: 'chart',
            filled: done.monitoring,
          },
          { title: SECTION_TITLES.drugs, to: paths.drugs(id), icon: 'pills', filled: done.drugs },
          { title: SECTION_TITLES.fluids, to: paths.fluids(id), icon: 'drop', filled: done.fluids },
          { title: SECTION_TITLES.recovery, to: paths.recovery(id), icon: 'bed', filled: done.recovery },
          { title: SECTION_TITLES.newborn, to: paths.newborn(id), icon: 'family', filled: done.newborn },
        ];
        return (
          <>
            <Section header="Datos del caso">
              <TextRow
                label="Diagnóstico preop"
                value={c.diagnostico_preop}
                placeholder="—"
                onChange={(v) =>
                  update((d) => {
                    d.diagnostico_preop = v;
                  })
                }
              />
              <TextRow
                label="Sala"
                value={c.sala}
                onChange={(v) =>
                  update((d) => {
                    d.sala = v;
                  })
                }
              />
              <TextRow
                label="Servicio"
                value={c.servicio}
                onChange={(v) =>
                  update((d) => {
                    d.servicio = v;
                  })
                }
              />
            </Section>

            <Section header="Secciones">
              {rows.map((r) => (
                <SectionLinkRow key={r.to} title={r.title} to={r.to} icon={r.icon} filled={r.filled} />
              ))}
            </Section>

            <Section>
              <SectionLinkRow title={SECTION_TITLES.review} to={paths.review(id)} icon="doc" filled={false} />
            </Section>
          </>
        );
      }}
    </CaseScreen>
  );
}
