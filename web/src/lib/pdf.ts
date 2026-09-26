/** First `n` bytes of a blob as text (Blob.text where available, else FileReader). */
function blobHead(blob: Blob, n: number): Promise<string> {
  const head = blob.slice(0, n);
  if (typeof head.text === 'function') return head.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the PDF.'));
    r.readAsText(head);
  });
}

/**
 * Check that downloaded bytes really are a PDF (magic bytes, not the Content-Type: a proxy error
 * page can be a 200) and return them typed `application/pdf`, ready for `URL.createObjectURL`.
 */
export async function asPdfBlob(blob: Blob): Promise<Blob> {
  if (blob.size === 0) throw new Error('the server returned an empty file.');
  if ((await blobHead(blob, 5)) !== '%PDF-') {
    throw new Error(`the server returned ${blob.type || 'an unknown type'}, not a PDF.`);
  }
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
}
