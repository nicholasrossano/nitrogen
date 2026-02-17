#!/usr/bin/env python3
"""
Test script to verify export functionality works locally.
Run this before deploying to catch export issues early.
"""
import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.docx_exporter import DocxExporterService
from app.schemas.memo import MemoContent, CitationResponse
import pytest


@pytest.mark.asyncio
async def test_export():
    """Test DOCX export with sample data"""
    
    print("🧪 Testing DOCX Export...")
    print()
    
    # Sample memo content
    memo_content = MemoContent(
        title="Test Investment Memo",
        date="2024-02-09",
        executive_summary="This is a test memo to verify export functionality.",
        recommendation="proceed",
        recommendation_rationale="Test rationale for the recommendation.",
        evidence_summary="Summary of evidence collected during testing.",
        risks_and_assumptions="Test risks and assumptions.",
        open_questions=["Test question 1?", "Test question 2?"],
        citations=[
            CitationResponse(
                number=1,
                source_type="evidence",
                source_title="Test Evidence Document",
                excerpt="This is a test excerpt from the evidence.",
                chunk_id="550e8400-e29b-41d4-a716-446655440000",
            ),
            CitationResponse(
                number=2,
                source_type="corpus",
                source_title="Test Case Study",
                excerpt="This is a test excerpt from a case study.",
                chunk_id="550e8400-e29b-41d4-a716-446655440001",
            ),
        ],
    )
    
    try:
        # Test export service
        exporter = DocxExporterService()
        print(f"✓ DocxExporterService initialized")
        print(f"  Template path: {exporter.template_path}")
        print(f"  Template exists: {exporter.template_path.exists()}")
        print()
        
        # Generate DOCX
        print("Generating DOCX...")
        docx_bytes = exporter.generate(
            memo_content=memo_content,
            initiative_title="Test Initiative",
        )
        print(f"✓ DOCX generated successfully ({len(docx_bytes)} bytes)")
        print()
        
        # Save to test file
        test_output = Path(__file__).parent.parent / "exports" / "test_export.docx"
        test_output.parent.mkdir(parents=True, exist_ok=True)
        
        with open(test_output, "wb") as f:
            f.write(docx_bytes)
        
        print(f"✓ Test file saved to: {test_output}")
        print()
        print("✅ All tests passed!")
        print()
        print("You can open the test file to verify it looks correct:")
        print(f"  open {test_output}")
        
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(test_export())
