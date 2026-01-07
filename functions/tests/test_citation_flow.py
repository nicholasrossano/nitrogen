import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FUNCTIONS_DIR = ROOT / "functions"
for entry in (str(ROOT), str(FUNCTIONS_DIR)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

# Provide lightweight stubs for firebase_admin so that unified_scan can be
# imported without requiring the production dependency during unit tests.
if "firebase_admin" not in sys.modules:
    import types

    firebase_admin = types.ModuleType("firebase_admin")
    firestore_stub = types.ModuleType("firebase_admin.firestore")
    firestore_stub.SERVER_TIMESTAMP = object()

    class DocumentReference:  # pragma: no cover - typing only
        pass

    class Client:  # pragma: no cover - typing only
        pass

    class _DummyDoc:
        def __init__(self):
            self._data = {}

        def get(self):
            return types.SimpleNamespace(exists=False, to_dict=lambda: {})

        def set(self, data):  # pragma: no cover - cache no-op
            self._data = data

    class _DummyCollection:
        def document(self, _domain):
            return _DummyDoc()

    class _DummyFirestore:
        def collection(self, _name):
            return _DummyCollection()

    def client():
        return _DummyFirestore()

    firestore_stub.DocumentReference = DocumentReference
    firestore_stub.Client = Client
    firestore_stub.client = client
    firebase_admin.firestore = firestore_stub
    sys.modules["firebase_admin"] = firebase_admin
    sys.modules["firebase_admin.firestore"] = firestore_stub

if "openai" not in sys.modules:
    import types

    openai_stub = types.ModuleType("openai")

    class OpenAI:  # pragma: no cover - stubbed client
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs

    openai_stub.OpenAI = OpenAI
    sys.modules["openai"] = openai_stub

from unified.press_search import _normalize_hit
from citation_utils import build_citations
from prepare_card_data import _normalize_citations
import publisher_logo

publisher_logo.get_publisher_logo = lambda _url: ""


class CitationFlowTestCase(unittest.TestCase):
    def test_press_hit_passes_through_to_sources(self):
        raw_hit = {
            "title": "Sample Article",
            "content": "A detailed snippet about the event.",
            "source_url": "https://example.com/sample-article",
            "feed_name": "Example News",
            "published": "Oct 10, 2025",
        }

        normalized_hit = _normalize_hit(raw_hit)
        citations = build_citations([], [normalized_hit])
        sources, headlines = _normalize_citations(citations)

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["url"], "https://example.com/sample-article")
        self.assertEqual(sources[0]["name"], "Example News")
        self.assertIn("Sample Article", headlines)

    def test_fixed_and_press_citations_deduplicated(self):
        fixed = [{
            "segment": "Apple Books",
            "article_index": 1,
            "feed_name": "Apple Books",
            "source_url": "https://books.apple.com/item"
        }]

        press = [{
            "title": "Apple Books",
            "content": "",
            "source_url": "https://books.apple.com/item",
            "feed_name": "Apple Books",
        }]

        normalized_press = [_normalize_hit(h) for h in press]
        citations = build_citations(fixed, normalized_press)
        sources, headlines = _normalize_citations(citations)

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["url"], "https://books.apple.com/item")
        self.assertEqual(sources[0]["name"], "Apple Books")
        self.assertEqual(headlines, [])


if __name__ == "__main__":
    unittest.main()
