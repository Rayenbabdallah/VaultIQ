FROM python:3.12-slim

WORKDIR /app

# System deps for WeasyPrint, lxml, Pillow, Tesseract
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libfontconfig1 \
    libglib2.0-0 \
    libcairo2 \
    libgdk-pixbuf-xlib-2.0-0 \
    libxml2 \
    libxslt1.1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and supporting assets
COPY api/        ./api/
COPY data/       ./data/
COPY templates/  ./templates/
COPY scripts/    ./scripts/
COPY entrypoint.sh ./entrypoint.sh

# Writable runtime directories
RUN mkdir -p vault/unsigned vault/signed db \
 && chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
