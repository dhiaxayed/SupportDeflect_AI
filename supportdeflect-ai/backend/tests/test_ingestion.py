from app.services.ingestion import chunk_text, clean_text


def test_clean_and_chunk_text():
    raw = "Title\n\n" + "API keys can be regenerated from Settings. " * 80
    cleaned = clean_text(raw)
    chunks = chunk_text(cleaned, max_chars=300, overlap=40)
    assert "API keys" in cleaned
    assert len(chunks) >= 2
    assert all(len(chunk) <= 360 for chunk in chunks)
