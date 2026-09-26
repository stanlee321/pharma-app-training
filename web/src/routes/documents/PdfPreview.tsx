import { Icon } from '../../components/Icon';
import { formatSize } from '../../state/documents';
import type { PdfPreviewState } from './usePdfPreview';
import '../review/review.css';

/** The inline PDF viewer of a stored document: title, Download (from the blob URL), Close. */
export function PdfPreview({ preview, onClose }: { preview: PdfPreviewState; onClose: () => void }) {
  return (
    <div className="review-pdf">
      <div className="row review-pdf__bar">
        <span className="review-pdf__title">
          {preview.title} · {formatSize(preview.size)}
        </span>
        <a className="btn-plain review-download" href={preview.url} download={preview.fileName}>
          <Icon name="download" size={16} />
          Download PDF
        </a>
        <button type="button" className="btn-plain" onClick={onClose}>
          Close
        </button>
      </div>
      <iframe className="review-pdf__frame" src={preview.url} title={`${preview.title} (PDF)`} />
    </div>
  );
}
