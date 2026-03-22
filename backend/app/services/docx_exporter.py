import io
from pathlib import Path

from app.schemas.memo import MemoContent


class DocxExporterService:
    """Service for exporting memos to DOCX format"""
    
    def __init__(self):
        self.template_path = Path(__file__).parent.parent.parent / "templates" / "memo_template.docx"
    
    def generate(
        self,
        memo_content: MemoContent,
        initiative_title: str,
    ) -> bytes:
        """Generate DOCX from memo content (legacy flat structure)"""
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            # Check if we have a template
            if self.template_path.exists():
                logger.info(f"Using template at {self.template_path}")
                return self._generate_from_template(memo_content, initiative_title)
            else:
                logger.info("Template not found, using basic DOCX generation")
                return self._generate_basic(memo_content, initiative_title)
        except Exception as e:
            logger.error(f"Failed to generate DOCX: {str(e)}", exc_info=True)
            raise
    
    def generate_from_sections(
        self,
        memo_content: dict,
        initiative_title: str,
    ) -> bytes:
        """Generate DOCX from memo content with dynamic sections structure"""
        from docx import Document
        from docx.shared import Inches, Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        import logging
        
        logger = logging.getLogger(__name__)
        
        try:
            doc = Document()
            
            # Title
            title = doc.add_heading(memo_content.get("title", "Investment Memo"), 0)
            title.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # Date
            date_para = doc.add_paragraph(f"Date: {memo_content.get('date', 'N/A')}")
            date_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            
            doc.add_paragraph()
            
            # Recommendation
            recommendation = memo_content.get("recommendation", "hold").upper()
            doc.add_heading("Recommendation", level=1)
            rec_para = doc.add_paragraph()
            rec_run = rec_para.add_run(recommendation)
            rec_run.bold = True
            rec_run.font.size = Pt(14)
            
            doc.add_paragraph()
            
            # Dynamic sections
            sections = memo_content.get("sections", [])
            for section in sections:
                section_title = section.get("title", "Section")
                section_content = section.get("content", "")
                
                doc.add_heading(section_title, level=1)
                doc.add_paragraph(section_content)
                doc.add_paragraph()
            
            # Citations
            citations = memo_content.get("citations", [])
            if citations:
                doc.add_heading("References", level=1)
                for citation in citations:
                    number = citation.get("number", 0)
                    source_type = citation.get("source_type", "evidence")
                    source_title = citation.get("source_title", "Unknown")
                    excerpt = citation.get("excerpt", "")
                    
                    source_label = "[Case Study]" if source_type == "corpus" else "[Evidence]"
                    doc.add_paragraph(f"[{number}] {source_label} {source_title}")
                    
                    if excerpt:
                        excerpt_para = doc.add_paragraph(f'"{excerpt}"')
                        excerpt_para.paragraph_format.left_indent = Inches(0.5)
            
            # Save to bytes
            output = io.BytesIO()
            doc.save(output)
            output.seek(0)
            return output.read()
        
        except Exception as e:
            logger.error(f"Failed to generate DOCX from sections: {str(e)}", exc_info=True)
            raise
    
    def _generate_from_template(
        self,
        memo_content: MemoContent,
        initiative_title: str,
    ) -> bytes:
        """Generate using docxtpl template"""
        from docxtpl import DocxTemplate
        
        doc = DocxTemplate(self.template_path)
        
        # Prepare context
        context = {
            "title": memo_content.title,
            "date": memo_content.date,
            "initiative_title": initiative_title,
            "executive_summary": memo_content.executive_summary,
            "recommendation": memo_content.recommendation.upper(),
            "recommendation_rationale": memo_content.recommendation_rationale,
            "evidence_summary": memo_content.evidence_summary,
            "risks_and_assumptions": memo_content.risks_and_assumptions,
            "open_questions": memo_content.open_questions,
            "citations": [
                {
                    "number": c.number,
                    "source_type": c.source_type,
                    "source_title": c.source_title,
                    "excerpt": c.excerpt,
                }
                for c in memo_content.citations
            ],
        }
        
        doc.render(context)
        
        # Save to bytes
        output = io.BytesIO()
        doc.save(output)
        output.seek(0)
        return output.read()
    
    def _generate_basic(
        self,
        memo_content: MemoContent,
        initiative_title: str,
    ) -> bytes:
        """Generate basic DOCX without template"""
        from docx import Document
        from docx.shared import Inches, Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        
        doc = Document()
        
        # Title
        title = doc.add_heading(memo_content.title, 0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        # Date
        date_para = doc.add_paragraph(f"Date: {memo_content.date}")
        date_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        
        doc.add_paragraph()
        
        # Executive Summary
        doc.add_heading("Executive Summary", level=1)
        doc.add_paragraph(memo_content.executive_summary)
        
        # Recommendation
        doc.add_heading("Recommendation", level=1)
        rec_para = doc.add_paragraph()
        rec_run = rec_para.add_run(memo_content.recommendation.upper())
        rec_run.bold = True
        rec_run.font.size = Pt(14)
        
        doc.add_paragraph(memo_content.recommendation_rationale)
        
        # Evidence Summary
        doc.add_heading("Evidence Summary", level=1)
        doc.add_paragraph(memo_content.evidence_summary)
        
        # Risks and Assumptions
        doc.add_heading("Risks and Assumptions", level=1)
        doc.add_paragraph(memo_content.risks_and_assumptions)
        
        # Open Questions
        if memo_content.open_questions:
            doc.add_heading("Open Questions", level=1)
            for question in memo_content.open_questions:
                doc.add_paragraph(f"• {question}")
        
        # Citations
        if memo_content.citations:
            doc.add_heading("References", level=1)
            for citation in memo_content.citations:
                source_label = "[Case Study]" if citation.source_type == "corpus" else "[Evidence]"
                doc.add_paragraph(
                    f"[{citation.number}] {source_label} {citation.source_title}"
                )
                excerpt_para = doc.add_paragraph(f'"{citation.excerpt}"')
                excerpt_para.paragraph_format.left_indent = Inches(0.5)
        
        # Save to bytes
        output = io.BytesIO()
        doc.save(output)
        output.seek(0)
        return output.read()
