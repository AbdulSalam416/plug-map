"""README reader: match vocabulary patterns line by line, after removing badges, images and code blocks."""
import os
import re

from .deps import read_text


def clean(text):
    text = re.sub(r"```.*?```", " ", text, flags=re.S)                                  # code blocks
    text = re.sub(r"\[!\[[^\]]*\][^\]]*\]\([^)]*\)", " ", text)                         # badges
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)                                   # images
    text = re.sub(r"<[^>]+>", " ", text)                                                # html tags
    text = re.sub(r"(?m)^\s*\.\. (image|figure|\|[^|]*\| image)::.*$", " ", text)       # rst images
    text = re.sub(r"https?://\S+\.(png|svg|jpe?g|gif)\S*", " ", text, flags=re.I)       # image urls
    return text


def readme_file(files):
    names = sorted(f for f in files if f.lower().startswith("readme"))
    return names[0] if names else None


def claims(vocab, repo_dir, files, home_of=()):
    """One claim per term found, with the first matching line as evidence.

    Ecosystem names are often mentioned without being used (community links, citations),
    so for kind "ecosystem" the line must also contain a usage word from the settings.
    """
    name = readme_file(files)
    if not name:
        return []
    found = {}
    for line in clean(read_text(os.path.join(repo_dir, name))).splitlines():
        if not line.strip():
            continue
        for term, rx in vocab.readme.items():
            if term in found or term in home_of:
                continue
            if rx.search(line) and (vocab.kind(term) != "ecosystem" or vocab.usage_words.search(line)):
                found[term] = {"term": term, "role": "uses", "method": "readme", "weak": False,
                               "evidence": line.strip()[:220], "file": name}
    return list(found.values())
