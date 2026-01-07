#!/usr/bin/env python3
"""
Standalone live-test for OpenAlex + Bing extraction.
No dependencies on research_academia.py or spaCy/torch.
"""

import sys
import json
import logging
from datetime import datetime, timedelta

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── CONFIGURE THESE ─────────────────────────────────────────────────────────
OPENALEX_API_URL      = 'https://api.openalex.org/works'
OPENALEX_EMAIL        = 'your-email@example.com'        # set your email or leave blank
BING_API_KEY          = '5944d84.....'                  # your actual key here
BING_NEWS_ENDPOINT    = 'https://api.bing.microsoft.com/v7.0/news/search'
# ─────────────────────────────────────────────────────────────────────────────

def fetch_academic_metadata(hour_limit: int, research_limit: int):
    """
    Pull the newest works from OpenAlex in the last `hour_limit` hours,
    sorted by citation count, limited to `research_limit`.
    Retries without mailto if the first attempt returns 403.
    """
    cutoff = datetime.utcnow() - timedelta(hours=hour_limit)
    cutoff_str = cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')
    params = {
        'filter':   f'from_update_date:{cutoff_str}',
        'sort':     'cited_by_count:desc',
        'per_page': research_limit
    }
    if OPENALEX_EMAIL:
        params['mailto'] = OPENALEX_EMAIL

    r = requests.get(OPENALEX_API_URL, params=params)
    if r.status_code == 403 and 'mailto' in params:
        logger.warning("OpenAlex returned 403 with mailto; retrying without it")
        params.pop('mailto')
        r = requests.get(OPENALEX_API_URL, params=params)

    r.raise_for_status()
    data = r.json().get('results', [])
    works = []
    for w in data:
        works.append({
            'title':           w.get('title', ''),
            'abstract':        ' '.join(w.get('abstract_inverted_index', {}).keys()),
            'authors':         [a['author']['display_name'] for a in w.get('authorships', [])],
            'doi':             w.get('doi', ''),
            'url':             w.get('id', ''),
            'journal':         w.get('host_venue', {}).get('display_name', ''),
            'publicationDate': w.get('publication_date', ''),
            'keywords':        [c['display_name'] for c in w.get('concepts', [])]
        })
    return works

def fetch_related_articles(work: dict):
    """
    Use Bing News Search to find up to 4 articles mentioning title+authors.
    """
    headers = {'Ocp-Apim-Subscription-Key': BING_API_KEY}
    params = {'q': f"{work['title']} {' '.join(work['authors'])}", 'count': 4}
    r = requests.get(BING_NEWS_ENDPOINT, headers=headers, params=params)
    r.raise_for_status()

    sources = []
    for hit in r.json().get('value', []):
        try:
            html = requests.get(hit['url'], timeout=10).text
            text = BeautifulSoup(html, 'html.parser').get_text()
            sources.append({
                'title':   hit.get('name', ''),
                'content': text,
                'url':     hit.get('url', '')
            })
        except Exception as e:
            logger.warning(f"Failed to scrape {hit.get('url')}: {e}")
    return sources

def main():
    # 1) Fetch one recent paper
    logger.info("→ Fetching academic metadata from OpenAlex…")
    works = fetch_academic_metadata(hour_limit=24, research_limit=1)
    if not works:
        logger.error("❌ No works returned from OpenAlex.")
        sys.exit(1)

    work = works[0]
    print("\n=== OpenAlex Work ===")
    print(json.dumps(work, indent=2))

    # 2) Fetch related news
    logger.info("→ Fetching related articles via Bing…")
    sources = fetch_related_articles(work)
    if not sources:
        logger.error("❌ No related articles found via Bing.")
        sys.exit(1)

    first = sources[0]
    snippet = first['content'][:200].replace('\n', ' ')
    print("\n=== First Related Article ===")
    print(json.dumps({
        'title':   first['title'],
        'url':     first['url'],
        'snippet': snippet + '...'
    }, indent=2))

    print("\n🎉 Live API + extraction test passed!")

if __name__ == '__main__':
    main()
