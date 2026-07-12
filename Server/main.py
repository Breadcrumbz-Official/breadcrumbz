#Judges, the server that will be running during the judging period is a different one hosted on cloudflare. Said server has been provided for your convenience in the extension already in background.js and search.js.


import json
import os
import re
import sqlite3
import threading
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from google import genai
from google.genai import errors, types

from keybert import KeyBERT

CHARS_PER_KEYWORD = 30

keybert_model = KeyBERT()

with open("filler.txt", encoding="utf-8") as filler_file:
    FILLER_WORDS = {
        line.strip().lower()
        for line in filler_file
        if line.strip()
    }

db = sqlite3.connect("keywords.db", check_same_thread=False)
db_lock = threading.Lock()

GEMINI_MODEL = "gemini-flash-lite-latest"

KEYWORD_BATCH_SIZE = 5000
GEMINI_MAX_RETRIES = 4
GEMINI_RETRY_BASE_SECONDS = 5
gemini_client = (
    genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    if os.environ.get("GEMINI_API_KEY")
    else None
)

def extract(text): # top keywords
    text = text.lower()

    meaningful_words = [
        word
        for word in text.split()
        if word not in FILLER_WORDS
    ]
    filtered_text = " ".join(meaningful_words)
    number_of_keywords = len(filtered_text) // CHARS_PER_KEYWORD

    keywords = keybert_model.extract_keywords(
        filtered_text,
        keyphrase_ngram_range=(1, 1),   
        stop_words="english",           
        top_n=number_of_keywords,
        use_mmr=True,                   
        diversity=0.3)   # tweakable

    keywords = [
        (word, score)
        for word, score in keywords
        if not any(character.isdigit() for character in word)
    ]

    return keywords

def init_db():
    # keywords, occurances
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS keywords (
            id   INTEGER PRIMARY KEY,
            word TEXT UNIQUE
        );

        CREATE TABLE IF NOT EXISTS occurrences (
            id         INTEGER PRIMARY KEY,
            keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
            url        TEXT    NOT NULL,
            char_index INTEGER NOT NULL,
            score      REAL
        );

        CREATE INDEX IF NOT EXISTS idx_occurrences_keyword
            ON occurrences(keyword_id);
        """
    )
    db.commit()


def store(text, url):
    keywords = extract(text)
    lowered_text = text.lower()

    with db_lock:
        db.execute("DELETE FROM occurrences WHERE url = ?", (url,))

        for word, score in keywords:
            db.execute(
                "INSERT OR IGNORE INTO keywords (word) VALUES (?)",
                (word,),
            )
            keyword_id = db.execute(
                "SELECT id FROM keywords WHERE word = ?",
                (word,),
            ).fetchone()[0]

            word_pattern = r"\b" + re.escape(word) + r"\b"
            match = re.search(word_pattern, lowered_text)
            if match:
                db.execute(
                    "INSERT INTO occurrences (keyword_id, url, char_index, score) "
                    "VALUES (?, ?, ?, ?)",
                    (keyword_id, url, match.start(), score),
                )

        db.commit()

    return keywords       # removing duplicates


def search(word):
    rows = db.execute(
        """
        SELECT o.url, o.char_index, o.score
        FROM occurrences o
        JOIN keywords k ON k.id = o.keyword_id
        WHERE k.word = ?
        ORDER BY o.score DESC, o.char_index ASC
        """,
        (word.lower(),),
    ).fetchall()
    return rows

def all_keywords():
    rows = db.execute("SELECT word FROM keywords ORDER BY word").fetchall()
    return [word for (word,) in rows]


def match_keywords_batch(query, batch):
    prompt = (
        "A user is searching for content. Their request is:\n"
        f"    \"{query}\"\n\n"
        "Below is a list of available keywords. Return a JSON array containing "
        "only the keywords from this list that are relevant to the user's "
        "request. Include semantically related matches (synonyms and closely "
        "related concepts), but only ever output words that appear exactly in "
        "the list. If none are relevant, return an empty array.\n\n"
        f"Keywords: {json.dumps(batch)}"
    )

    for attempt in range(GEMINI_MAX_RETRIES):
        try:
            response = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=list[str],
                ),
            )
            return json.loads(response.text)
        except errors.ClientError as error:
            is_rate_limited = getattr(error, "code", None) == 429
            is_last_attempt = attempt == GEMINI_MAX_RETRIES - 1
            if not is_rate_limited or is_last_attempt:
                raise
            time.sleep(GEMINI_RETRY_BASE_SECONDS * (2 ** attempt))


def match_keywords(query, keywords):
    if not keywords:
        return []

    keyword_set = set(keywords)
    matched = []
    already_added = set()

    for start in range(0, len(keywords), KEYWORD_BATCH_SIZE):
        batch = keywords[start:start + KEYWORD_BATCH_SIZE]
        for word in match_keywords_batch(query, batch):
            if word in keyword_set and word not in already_added:
                already_added.add(word)
                matched.append(word)

    return matched

init_db()

app = FastAPI(title="Keyword Index")

class IndexRequest(BaseModel):
    text: str
    url: str


class FindRequest(BaseModel):
    query: str


@app.post("/index")
def index_endpoint(request: IndexRequest):
    keywords = store(request.text, request.url)
    return {
        "status": "ok",
        "keywords": [word for word, score in keywords],
    }


@app.post("/find")
def find_endpoint(request: FindRequest):
    if gemini_client is None:
        raise HTTPException(
            status_code=503,
            detail="Gemini not configured.",
        )

    keywords = all_keywords()
    try:
        matched = match_keywords(request.query, keywords)
    except errors.ClientError as error:
        if getattr(error, "code", None) == 429:
            raise HTTPException(
                status_code=429,
                detail="Gemini rate limit.",
            )
        raise HTTPException(status_code=502, detail=f"Gemini error: {error}")

    results = []
    for word in matched:
        for url, char_index, score in search(word):
            results.append({
                "keyword": word,
                "url": url,
                "char_index": char_index,
                "score": score,
            })

    return {
        "query": request.query,
        "matched_keywords": matched,
        "count": len(results),
        "results": results,
    }

#Judges please ignore this, the server that will be running during the judging period is a different one hosted on cloudflare. Said server has been provided for your convenience in the extension already.
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)    # hosted on same network; just for the hackathon; not commercially ready. Uses a cloudflare tunnel for judging.
