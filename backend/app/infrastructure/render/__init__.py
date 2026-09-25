"""Fill-PDF render package: stamp case data into the real anaesthesia-form clones.

``render_case_pdf`` is the one entry point used by export, document generation and finalize:
the real form first, the summary PDF when anything about the real form fails.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .renderer import FORM_MAP, FormRenderer
from .summary import render_summary_pdf

__all__ = ["FORM_MAP", "FormRenderer", "RenderedPdf", "render_case_pdf", "render_summary_pdf"]

logger = logging.getLogger(__name__)
_default_renderer = FormRenderer()


@dataclass(frozen=True)
class RenderedPdf:
    content: bytes
    is_fallback: bool  # True -> the summary PDF, not the real form


def render_case_pdf(case, form_id: str, renderer: FormRenderer | None = None) -> RenderedPdf:
    """Render the real filled form; on ANY renderer failure fall back to the summary PDF.

    The summary itself is not guarded: if even that fails the caller gets the exception.
    """
    try:
        return RenderedPdf((renderer or _default_renderer).render(case, form_id), False)
    except Exception:  # noqa: BLE001 - never fail on the real form; degrade to the summary
        logger.warning("fill-pdf render failed for form_id=%s; using summary", form_id,
                       exc_info=True)
        return RenderedPdf(render_summary_pdf(case, form_id), True)
