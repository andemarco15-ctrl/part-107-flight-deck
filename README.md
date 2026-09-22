# Preflight

Version 1.0 (see `VERSION`; `tools/stamp.py` stamps it into the site on publish, and the running site polls `version.json` to offer an update).

**Live at https://uaspart107.com**

Test site: https://andemarco15-ctrl.github.io (marked TEST, hidden from search engines).

Publishing:

```bash
./test.sh "what changed"   # put the current work on the test site
./ship.sh "what changed"   # merge the tested version to uaspart107.com
```

Free practice for the FAA Part 107 Remote Pilot knowledge test: 250 original questions across all seven test subjects, each with an explanation and a link to the FAA source behind it.

## What's inside

- **Dashboard**: streak, questions explored, mastered count, first-try accuracy, and progress for each subject.
- **Study cards**: practice sessions of 10, 30, 60, or 100 cards, from every subject or just one. You get two tries per card, then the answer and explanation. Cards from your last session are held back, so each session feels fresh. There's also a timed 60-question **exam simulation** with a 70% pass mark, like the real test.
- **All questions**: search and filter the full bank by subject, difficulty, your status, or FAA source.

Progress is saved in the browser (localStorage). Settings has export and import so you can move progress between devices.

## Editing questions

All questions live in [`assets/questions.js`](assets/questions.js). Each entry has one `answer` and three `distractors`; the app shuffles the four choices. Keep `category` to one of the seven listed subjects.

## Running it locally

It's a static site with no build step. From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Disclaimer

Educational practice aid—not an FAA endorsement, actual FAA question bank, or substitute for current regulations, NOTAMs, authorizations, and operational judgment.
