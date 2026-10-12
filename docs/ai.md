# The AI step

`python -m plugmap propose` finds vocabulary gaps. It is optional: the map is built from rules alone. AI only suggests rules for a person to add.

## Setup

```bash
cp .env.example .env
# edit .env:  OPENAI_API_KEY=sk-...
```

- `.env` is git-ignored and read only by the `propose` command. Keys already set in your shell (`export OPENAI_API_KEY=...`) take priority.
- **Never paste a key into any other file**, a commit, an issue or a chat. If a key has been exposed, revoke it in the provider's console and create a new one.

Provider and model defaults are in `config/categories.yml`:

```yaml
ai:
  provider: openai               # openai | anthropic
  models:
    openai: gpt-6-luna
    anthropic: claude-haiku-5-5
  max_readme_chars: 12000
  max_tokens: 1500
```

Change the model IDs there if your account uses different ones. Override per run with `--provider` and `--model`.

## Running

```bash
python -m plugmap propose --category "Renewable Energy" --limit 20
python -m plugmap propose --category "Energy Systems" --provider anthropic
```

1. Tools in the category are sorted by how few specific terms the rules found (then by stars), and the first `--limit` READMEs are used.
2. Each README is cleaned (no badges, images or code blocks) and cut to `max_readme_chars`.
3. The model receives the list of known terms and the README between two lines like `README-3f9a1c2b7d4e`. That random fence changes every call, so README text can't fake the end of the data. The system prompt says the fenced text is untrusted and must not be followed.
4. The model answers with JSON: `{"terms": [{name, kind, role, quote}]}`.
5. **Verification:**
   - each `quote` must appear in the README word for word (ignoring whitespace and case), or the item is dropped;
   - the quote must say something beyond the name: at least two other words (`MIN_CONTEXT_WORDS`). A heading or list item that only names the term (`"I2C"`) proves nothing about use, so it is dropped;
   - `kind` and `role` are mapped onto the allowed values. Common variants are accepted (`data-source` → `source`, `builds on` → `builds-on`), and a kind given in the `role` field is moved to `kind`. A kind that still isn't recognised is left empty for the reviewer rather than guessed;
   - items the vocabulary already matches are dropped;
   - names already proposed (open, accepted or rejected) aren't added again, but another tool is noted under `also_found_in`.
6. Survivors are appended to `vocab/proposals.yml` with `status: open`, `proposed_by: <provider>:<model>` and the date. The site data is rebuilt (skip that with `--no-site`).

APIs: OpenAI via `POST https://api.openai.com/v1/responses` (`instructions` + `input`); Anthropic via `POST https://api.anthropic.com/v1/messages`. Rate limits and server errors are retried with backoff. Only the standard library is used, with no SDKs.

## Reviewing proposals

Proposals are shown on the site's Vocabulary page with their quotes. To decide, edit `vocab/proposals.yml`:

- **Accept:** add a real term to `vocab/core.yml` or a pack, with an id, kind, dependencies, a README regex and code patterns where possible (see [vocabulary.md](vocabulary.md)). Then set the proposal's `status: accepted`. A proposal is only a hint: the term you write is what counts.
- **Reject:** set `status: rejected`. Typical reasons: too vague ("solar irradiance data"), an installation detail, or something mentioned but not used.

Then run `python -m plugmap validate`, re-run the category, and commit.

## What the pilot showed

A pilot on 12 tools the rules found nothing in:
- the model found plausible plugs in 9;
- 68% of its items were outside the vocabulary (which is the point);
- READMEs gave a read/write direction for only about a third of items.

So AI is good at discovering *what* to look for. Rules over code remain the source of direction and precision. The 27 seed proposals in `vocab/proposals.yml` come from that pilot.

## Testing without a key

`tests/test_ai.py` runs the whole step with a fake model. It covers parsing both providers' reply shapes, dropping invented quotes and known terms, fencing, and the missing-key message.
