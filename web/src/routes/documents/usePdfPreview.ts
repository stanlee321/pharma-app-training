import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../lib/datetime';
import { asPdfBlob } from '../../lib/pdf';
import { documentFileName } from '../../state/documents';
import { exportErrorMessage, formTitle } from '../../state/review';
import type { DocumentDTO } from '../../api/types';

export interface PdfPreviewState {
  docId: string;
  url: string;
  title: string;
  fileName: string;
  size: number;
}

type PreviewDoc = Pick<DocumentDTO, 'id' | 'form_id' | 'case_id' | 'created_at'>;

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/**
 * Open a stored document inline: fetch its bytes through the authenticated HTTP layer (`load`),
 * check the `%PDF-` magic, and show them from a blob URL (never a bare link to the API, which
 * would lack the token). Each blob URL lives exactly as long as it is displayed: it is revoked
 * when replaced, closed or unmounted. A slower, older open never replaces a newer one.
 */
export function usePdfPreview(load: (docId: string) => Promise<Blob>) {
  const [preview, setPreview] = useState<PdfPreviewState | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const seqRef = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!preview) return;
    const { url } = preview;
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const open = useCallback(async (d: PreviewDoc) => {
    const seq = ++seqRef.current;
    setOpening(d.id);
    setError(null);
    try {
      const pdf = await asPdfBlob(await loadRef.current(d.id));
      if (!mounted.current || seq !== seqRef.current) return;
      setPreview({
        docId: d.id,
        url: URL.createObjectURL(pdf),
        title: `${formTitle(d.form_id)} · ${formatDateTime(d.created_at)}`,
        fileName: documentFileName(d),
        size: pdf.size,
      });
    } catch (e) {
      if (mounted.current && seq === seqRef.current) setError(exportErrorMessage(e, online(), 'No se pudo descargar el PDF'));
    } finally {
      if (mounted.current && seq === seqRef.current) setOpening(null);
    }
  }, []);

  const close = useCallback(() => setPreview(null), []);

  return { preview, opening, error, setError, open, close };
}
