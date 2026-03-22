# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2025-03-22

### Added

- **Conversational intake** -- chat-based AI assistant to define an initiative
- **Evidence upload** -- upload documents or paste text as supporting evidence for RAG retrieval
- **Memo generation** -- generate structured investment memos with citations grounded in uploaded evidence and a curated case study corpus
- **DOCX export** -- export memos as formatted Word documents
- **Access code gate** -- simple shared-access flow for private beta
- **Tiered RAG retrieval** -- corpus search, web search, and LLM fallback with confidence scoring
- **Firebase Authentication** support (optional)
- **Docker Compose** setup for local development
- **Neon + pgvector** database with async SQLAlchemy
- **Alembic** migrations

[Unreleased]: https://github.com/nicholasrossano/nitrogen/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nicholasrossano/nitrogen/releases/tag/v0.1.0
