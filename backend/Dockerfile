FROM python:3.12-slim

WORKDIR /app

# Install system dependencies:
# - LibreOffice: iWork -> Office conversion
# - default-jre: required by opendataloader-pdf (Java CLI) for PDF extraction;
#   without it the parser falls back to pdfplumber.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    default-jre \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create exports directory
RUN mkdir -p /app/exports

EXPOSE 8000

# Railway sets PORT env var; default to 8000 for local
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
