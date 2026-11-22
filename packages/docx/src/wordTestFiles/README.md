# Word test documents

Real `.docx` files saved by Microsoft Word, used as inputs to the DOCX tests
and the fidelity suite (`src/__tests__/fidelity`).

## Where they come from

Every document is from [superdoc/docx-corpus](https://github.com/superdoc/docx-corpus),
a corpus of `.docx` files found through Common Crawl's index of public web
pages. `SOURCES.tsv` lists each file with its `corpus_id`, the id of its entry
in that corpus, along with the type, topic and Word metadata it was chosen by.

## Rights

The corpus is MIT-licensed, but that licence covers its code, not the
documents. Each document was published on the web by its author, who keeps
its copyright. They are kept here only as test inputs: `@scrivr/docx`
publishes `dist` alone, so none of them ships in the package.

## Adding one

Save it from Word, so the file carries what Word recorded about its own
layout. Name it `NN-type-<first 12 characters of its corpus id>.docx`, and add
its row to `SOURCES.tsv`. The fidelity suite loads every `.docx` here; record
the new baselines from `packages/docx` with
`UPDATE_FIDELITY_SCORES=1 npx vitest run -u src/__tests__/fidelity`.
