This is **sample content**. The repository ships these fixtures so anyone can run the app end to end; the real lessons live in a private content repo and appear only on the deployed site at deepcs.org.

## What a sample process is

Every lesson opens a section with a one-or-two sentence big-picture statement, and this fixture does the same so the rendering is honest.

A lesson body is markdown split on `##` headings, one section per screen. Terms are defined in brackets at first use [like this], and code lines stay under 78 characters so nothing scrolls sideways.

```python
def sample(step: int) -> str:
    return f"section {step} renders one screen"
```

## Why the fixture has a code fence

So Prism's highlighting path runs in every local build, not only in production. A fenced block with no language falls through to plain text, which is what most real lessons use for ASCII diagrams.

```
 a diagram stays a diagram
 +--------------------+
 |  no tokenizer runs |
 +--------------------+
```
