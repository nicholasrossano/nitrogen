"""Initial schema

Revision ID: 001
Revises: 
Create Date: 2026-01-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    
    # Create initiatives table
    op.create_table(
        'initiatives',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', sa.String(255), nullable=False, index=True),
        sa.Column('title', sa.String(255)),
        sa.Column('sector', sa.String(100), server_default='clean_cooking'),
        sa.Column('geography', sa.String(255)),
        sa.Column('target_population', sa.Text),
        sa.Column('goal', sa.Text),
        sa.Column('budget_range', sa.String(100)),
        sa.Column('timeline', sa.String(100)),
        sa.Column('constraints', postgresql.ARRAY(sa.Text)),
        sa.Column('stage', sa.String(20), server_default='intake'),
        sa.Column('stage_1_complete', sa.Boolean, server_default='false'),
        sa.Column('evidence_ready', sa.Boolean, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create chat_messages table
    op.create_table(
        'chat_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('initiatives.id', ondelete='CASCADE'), index=True),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('widget_type', sa.String(50)),
        sa.Column('widget_data', postgresql.JSONB),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create evidence_docs table
    op.create_table(
        'evidence_docs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('initiatives.id', ondelete='CASCADE'), index=True),
        sa.Column('filename', sa.String(255)),
        sa.Column('file_type', sa.String(50)),
        sa.Column('storage_path', sa.String(500)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create evidence_chunks table
    op.create_table(
        'evidence_chunks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('evidence_doc_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('evidence_docs.id', ondelete='CASCADE'), index=True),
        sa.Column('chunk_index', sa.Integer, nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('embedding', Vector(1536)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create memo_versions table
    op.create_table(
        'memo_versions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('initiatives.id', ondelete='CASCADE'), index=True),
        sa.Column('content', postgresql.JSONB, nullable=False),
        sa.Column('export_path', sa.String(500)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create citations table
    op.create_table(
        'citations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('memo_version_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('memo_versions.id', ondelete='CASCADE'), index=True),
        sa.Column('section_name', sa.String(100)),
        sa.Column('citation_number', sa.Integer, nullable=False),
        sa.Column('chunk_id', postgresql.UUID(as_uuid=True)),
        sa.Column('source_type', sa.String(20), nullable=False, server_default='evidence'),
        sa.Column('excerpt', sa.Text),
    )
    
    # Create corpus_documents table
    op.create_table(
        'corpus_documents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('source', sa.String(255)),
        sa.Column('file_type', sa.String(50)),
        sa.Column('storage_path', sa.String(500)),
        sa.Column('metadata', postgresql.JSONB),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create corpus_chunks table
    op.create_table(
        'corpus_chunks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('corpus_doc_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('corpus_documents.id', ondelete='CASCADE'), index=True),
        sa.Column('chunk_index', sa.Integer, nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('embedding', Vector(1536)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    
    # Create vector indexes
    op.execute('''
        CREATE INDEX idx_evidence_chunks_embedding 
        ON evidence_chunks 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    ''')
    
    op.execute('''
        CREATE INDEX idx_corpus_chunks_embedding 
        ON corpus_chunks 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    ''')


def downgrade() -> None:
    op.drop_table('corpus_chunks')
    op.drop_table('corpus_documents')
    op.drop_table('citations')
    op.drop_table('memo_versions')
    op.drop_table('evidence_chunks')
    op.drop_table('evidence_docs')
    op.drop_table('chat_messages')
    op.drop_table('initiatives')
    op.execute('DROP EXTENSION IF EXISTS vector')
