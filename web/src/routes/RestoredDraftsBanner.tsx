import { plural } from '../lib/wording';
import { Icon } from '../components/Icon';
import { useAuthStore } from '../state/authStore';
import type { DraftRestoreReport } from '../state/caseStore';


/** What happened to the previous session's unsaved changes at this sign-in. */
export function RestoredDraftsBanner({ report }: { report: DraftRestoreReport }) {
  const lines: string[] = [];
  if (report.saved > 0) {
    lines.push(`Se restauraron los cambios sin guardar de ${plural(report.saved, 'caso', 'casos')} de su sesión anterior.`);
  }
  if (report.conflicts.length > 0) {
    lines.push(
      `No se aplicaron — cambiaron en el servidor desde su sesión anterior: ${report.conflicts.join(', ')}. Abra el caso para volver a aplicar o descartar sus cambios.`,
    );
  }
  if (report.deleted.length > 0) {
    lines.push(`No se restauraron — se eliminaron en el servidor: ${report.deleted.join(', ')}.`);
  }
  if (report.unsaved.length > 0) {
    lines.push(`Restaurados pero aún sin guardar: ${report.unsaved.join(', ')}. Abra el caso y vuelva a guardar.`);
  }
  if (report.kept.length > 0) {
    lines.push(
      `${plural(report.kept.length, 'borrador', 'borradores')} no se pudieron comprobar (servidor inaccesible); se ofrecerán de nuevo en su próximo inicio de sesión.`,
    );
  }
  return (
    <div className="banner banner--info" role="status">
      <Icon name="checkCircle" size={18} />
      <span className="banner__text">
        {lines.map((l) => (
          <span key={l} className="banner__line">
            {l}
          </span>
        ))}
      </span>
      <button type="button" className="btn-plain" onClick={() => useAuthStore.getState().clearRestoredDrafts()}>
        Aceptar
      </button>
    </div>
  );
}
