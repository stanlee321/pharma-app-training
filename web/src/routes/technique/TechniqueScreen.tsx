import { SECTION_TITLES } from '../../lib/wording';
import { Navigate, useParams } from 'react-router-dom';
import {
  isTechniqueZone,
  TECHNIQUE_ZONE_TITLES,
  type AnesthesiaCase,
  type TechniqueZone,
} from '../../api/types';
import { ChoiceChips, ToggleRow } from '../../components/Choice';
import { CheckboxValueRow } from '../../components/CheckboxValueRow';
import { NumberRow, StepperRow, TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import {
  GENERAL,
  getBool,
  getFlags,
  getNum,
  getText,
  NEURAXIAL,
  PERIPHERAL,
  setBool,
  setFlags,
  setNum,
  setText,
  valKey,
  type CheckboxValueField,
  type TechniqueValues,
} from '../../state/techniqueFields';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';
import { useCaseScope } from '../../state/caseScope';
import { TciChipSlot } from './TciChipSlot';

/**
 * N4a/b/c — Anesthetic Technique (Swift TechniqueScreen). Switches on the zone and binds every
 * field into `technique.values` (the `values_blob`, keyed by schema field id) exactly as the Swift
 * bindings do; the single-select Modalidad / Abordaje drives `technique.modality`.
 * An unknown zone redirects to General.
 */
export function TechniqueScreen() {
  const { id = '', zone } = useParams();
  const { paths } = useCaseScope();
  if (!isTechniqueZone(zone)) return <Navigate to={paths.technique(id, 'general')} replace />;
  return (
    <CaseScreen key={zone} title={`${SECTION_TITLES.technique} · ${TECHNIQUE_ZONE_TITLES[zone]}`}>
      {(c, update) => <ZoneForm zone={zone} c={c} update={update} />}
    </CaseScreen>
  );
}

interface ZoneProps {
  c: AnesthesiaCase;
  /** Mutate the technique of the draft case. */
  edit: (fn: (values: TechniqueValues, draft: AnesthesiaCase) => void) => void;
}

function ZoneForm({ zone, c, update }: { zone: TechniqueZone; c: AnesthesiaCase; update: CaseUpdate }) {
  const edit: ZoneProps['edit'] = (fn) =>
    update((d) => {
      fn(d.technique.values, d);
    });
  switch (zone) {
    case 'general':
      return <GeneralZone c={c} edit={edit} />;
    case 'neuraxial':
      return <NeuraxialZone c={c} edit={edit} />;
    case 'peripheral':
      return <PeripheralZone c={c} edit={edit} />;
  }
}

/** `modality` single-select (Swift `modalityBinding`). */
function ModalityChips({ title, options, c, edit }: ZoneProps & { title: string; options: readonly string[] }) {
  const m = c.technique.modality;
  return (
    <ChoiceChips
      title={title}
      options={options}
      selection={m === '' ? [] : [m]}
      onChange={(sel) =>
        edit((_v, d) => {
          d.technique.modality = sel[0] ?? '';
        })
      }
    />
  );
}

/** `<prefix><option>` flag group (Swift `multiBool`); single- or multi-select chips. */
function FlagChips({
  title,
  options,
  prefix,
  multiSelect = false,
  c,
  edit,
}: ZoneProps & { title: string; options: readonly string[]; prefix: string; multiSelect?: boolean }) {
  return (
    <ChoiceChips
      title={title}
      options={options}
      multiSelect={multiSelect}
      selection={getFlags(c.technique.values, options, prefix)}
      onChange={(sel) => edit((v) => setFlags(v, options, prefix, sel))}
    />
  );
}

/** `checkbox_value` rows: `<key>` bool + `<key>_val` number (Swift `TechCheckboxValueRow`). */
function DoseRows({ rows, c, edit }: ZoneProps & { rows: readonly CheckboxValueField[] }) {
  const v = c.technique.values;
  return (
    <>
      {rows.map((r) => (
        <CheckboxValueRow
          key={r.key}
          label={r.label}
          unit={r.unit}
          checked={getBool(v, r.key)}
          onCheckedChange={(b) => edit((x) => setBool(x, r.key, b))}
          value={getNum(v, valKey(r.key))}
          onValueChange={(n) => edit((x) => setNum(x, valKey(r.key), n))}
        />
      ))}
    </>
  );
}

function BoolToggle({ label, k, c, edit }: ZoneProps & { label: string; k: string }) {
  return (
    <ToggleRow
      label={label}
      checked={getBool(c.technique.values, k)}
      onChange={(b) => edit((x) => setBool(x, k, b))}
    />
  );
}

function TextField({
  label,
  k,
  placeholder,
  unit,
  c,
  edit,
}: ZoneProps & { label: string; k: string; placeholder?: string; unit?: string }) {
  return (
    <TextRow
      label={label}
      value={getText(c.technique.values, k)}
      placeholder={placeholder}
      unit={unit}
      onChange={(t) => edit((x) => setText(x, k, t))}
    />
  );
}

// ---- GENERAL ------------------------------------------------------------------------------

function GeneralZone(p: ZoneProps) {
  const v = p.c.technique.values;
  const stepper = (label: string, spec: typeof GENERAL.tetCalibre | typeof GENERAL.flujo) => (
    <StepperRow
      label={label}
      value={getNum(v, spec.key) ?? spec.fallback}
      onChange={(n) => p.edit((x) => setNum(x, spec.key, n))}
      unit={spec.unit}
      step={spec.step}
      min={spec.min}
      max={spec.max}
      decimals={1}
    />
  );
  return (
    <>
      <Section>
        <ModalityChips {...p} title="Modalidad" options={GENERAL.modalities} />
      </Section>
      <Section>
        <FlagChips
          {...p}
          title="Agentes volátiles"
          options={GENERAL.volatiles}
          prefix={GENERAL.volatilPrefix}
          multiSelect
        />
      </Section>
      <Section header="Inducción">
        <DoseRows {...p} rows={GENERAL.induccion} />
      </Section>
      <Section header="Vía aérea / Ventilación">
        {stepper('TET calibre', GENERAL.tetCalibre)}
        {stepper('Flujo', GENERAL.flujo)}
        <BoolToggle {...p} label="Intubación endotraqueal" k={GENERAL.intubacion} />
        <BoolToggle {...p} label="Ventilación controlada" k={GENERAL.ventControlada} />
      </Section>
      <Section header="TCI · ayuda (Propofol)">
        {/* TCI decision-aid chip (Swift TechTCIChip) — see TciChipSlot.tsx. */}
        <TciChipSlot
          modelId="marsh"
          patient={p.c.patient.profile}
          targetCp={getNum(v, GENERAL.tciTargetCp.key) ?? GENERAL.tciTargetCp.fallback}
          onTargetCpChange={(n) => p.edit((x) => setNum(x, GENERAL.tciTargetCp.key, n))}
        />
      </Section>
    </>
  );
}

// ---- NEURAXIAL ----------------------------------------------------------------------------

function NeuraxialZone(p: ZoneProps) {
  return (
    <>
      <Section>
        <ModalityChips {...p} title="Abordaje" options={NEURAXIAL.approach} />
      </Section>
      <Section>
        {/* Single-select in Swift (no multiSelect), but stored as per-needle flags. */}
        <FlagChips {...p} title="Aguja" options={NEURAXIAL.needles} prefix={NEURAXIAL.agujaPrefix} />
        <TextField {...p} label="Nivel" k={NEURAXIAL.nivel} placeholder="L3–L4" />
        <TextField {...p} label="Nº aguja" k={NEURAXIAL.agujaCalibre} placeholder="27G" unit="G" />
      </Section>
      <Section header="Dosis">
        <DoseRows {...p} rows={NEURAXIAL.dosis} />
      </Section>
    </>
  );
}

// ---- PERIPHERAL ---------------------------------------------------------------------------

function PeripheralZone(p: ZoneProps) {
  const v = p.c.technique.values;
  return (
    <>
      <Section>
        <TextField {...p} label="Sitio del bloqueo" k={PERIPHERAL.sitio} placeholder="Plexo braquial" />
        <NumberRow
          label="Volumen"
          unit="ml"
          value={getNum(v, PERIPHERAL.volumen)}
          onChange={(n) => p.edit((x) => setNum(x, PERIPHERAL.volumen, n))}
        />
        <BoolToggle {...p} label="Ecoguiado" k={PERIPHERAL.ecoguiado} />
        <BoolToggle {...p} label="Neuroestimulador" k={PERIPHERAL.neuroestimulador} />
      </Section>
      <Section>
        <FlagChips
          {...p}
          title="Anestésico local"
          options={PERIPHERAL.agents}
          prefix={PERIPHERAL.alPrefix}
          multiSelect
        />
      </Section>
      <Section header="Dosis">
        <DoseRows {...p} rows={PERIPHERAL.dosis} />
      </Section>
    </>
  );
}
