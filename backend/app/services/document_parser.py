import io
from typing import Optional
import tiktoken

from app.config import get_settings

settings = get_settings()


class DocumentParserService:
    """Service for parsing documents and chunking text"""
    
    def __init__(self):
        self.chunk_size = settings.chunk_size
        self.chunk_overlap = settings.chunk_overlap
        self.tokenizer = tiktoken.get_encoding("cl100k_base")
    
    def parse_pdf(self, content: bytes) -> str:
        """Parse PDF content to text"""
        import pdfplumber
        
        text_parts = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        
        return "\n\n".join(text_parts)
    
    def parse_docx(self, content: bytes) -> str:
        """Parse DOCX content to text"""
        from docx import Document
        
        doc = Document(io.BytesIO(content))
        text_parts = []
        
        for para in doc.paragraphs:
            if para.text.strip():
                text_parts.append(para.text)
        
        return "\n\n".join(text_parts)
    
    def chunk_text(self, text: str) -> list[str]:
        """Split text into chunks of approximately chunk_size tokens"""
        # Tokenize
        tokens = self.tokenizer.encode(text)
        
        # Split into chunks
        chunks = []
        start = 0
        
        while start < len(tokens):
            end = start + self.chunk_size
            
            # Get chunk tokens
            chunk_tokens = tokens[start:end]
            
            # Decode back to text
            chunk_text = self.tokenizer.decode(chunk_tokens)
            
            # Clean up chunk (try to end at sentence boundary)
            chunk_text = self._clean_chunk(chunk_text)
            
            if chunk_text.strip():
                chunks.append(chunk_text.strip())
            
            # Move start with overlap
            start = end - self.chunk_overlap
        
        return chunks
    
    def _clean_chunk(self, text: str) -> str:
        """Try to clean chunk boundaries at sentence ends"""
        # If chunk ends mid-sentence, try to find last sentence end
        sentence_ends = ['.', '!', '?', '\n']
        
        # Only truncate if we're not at the end
        if len(text) > 50:
            for i in range(len(text) - 1, max(len(text) - 100, 0), -1):
                if text[i] in sentence_ends:
                    return text[:i + 1]
        
        return text
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text"""
        return len(self.tokenizer.encode(text))
