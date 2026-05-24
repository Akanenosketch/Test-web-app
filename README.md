# SleepyTest

A lightweight, single-page quiz app that runs entirely in the browser. No build step, no server required — just open `index.html`.

Tests can come from two sources: **official tests** loaded automatically from a `manifest.json` sitting alongside the HTML file (ideal for GitHub Pages), and **custom tests** imported on the fly by dragging and dropping a JSON file.

## Project Structure

```
Test-web-app/
├── index.html          # Entry point
├── app.js              # All application logic
├── style.css           # Styles (dark/light theme)
├── manifest.json       # List of official tests to load automatically
└── local-tests/        # Official test JSON files
```

## Running Locally

Because the app fetches `manifest.json` via `fetch()`, it needs to be served over HTTP — opening `index.html` directly as a `file://` URL will block the request.

The simplest way is a one-liner from the project root:

```bash
# Python 3
python -m http.server 8080

# Node (if you have npx)
npx serve .
```

Then open `http://localhost:8080` in your browser.

## Hosting on GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages** and set the source to your `main` branch (root folder).
3. GitHub will publish the site at `https://<username>.github.io/<repo>/`.

The app will automatically fetch `manifest.json` on load and display all listed tests as official tests.

## manifest.json

`manifest.json` tells the app which test files exist in the repository. It must live in the same directory as `index.html`.

```json
{
  "tests": [
    { "id": "intro-quiz",   "file": "local-tests/intro-quiz.json" },
    { "id": "advanced-set", "file": "local-tests/advanced-set.json" }
  ]
}
```

| Field  | Type   | Required | Description |
|--------|--------|----------|-------------|
| `id`   | string | Yes      | A unique identifier for the test |
| `file` | string | Yes      | Path to the JSON file, relative to `index.html` |

## JSON Test Format

Each test is a `.json` file with the following structure.

### Full example

```json
{
  "title": "Introduction to Data Protection",
  "description": "Covers the basics of GDPR and personal data rights.",
  "author": "Jane Doe",
  "timeLimit": 30,
  "questions": [
    {
      "question": "Which article of the GDPR defines 'personal data'?",
      "options": [
        "Article 2",
        "Article 4",
        "Article 6",
        "Article 9"
      ],
      "answer": 1,
      "explanation": "Article 4 contains the definitions used throughout the regulation, including the definition of personal data as any information relating to an identified or identifiable natural person."
    },
    {
      "question": "The GDPR applies to processing carried out by organisations located outside the EU.",
      "options": ["True", "False"],
      "answer": 0
    }
  ]
}
```

### Top-level fields

| Field         | Type    | Required | Description |
|---------------|---------|----------|-------------|
| `title`       | string  | **Yes**  | Name of the test, shown in the test list and during the test |
| `description` | string  | No       | Short summary shown on the test card |
| `author`      | string  | No       | Shown as a subtitle on the test card |
| `timeLimit`   | number  | No       | Time limit in **minutes**. If omitted, there is no timer |
| `questions`   | array   | **Yes**  | Array of question objects (at least one required) |

### Question object

| Field         | Type    | Required | Description |
|---------------|---------|----------|-------------|
| `question`    | string  | **Yes**  | The question text |
| `options`     | array   | **Yes**  | Array of strings with the answer choices. Minimum 2, maximum 6 |
| `answer`      | number  | **Yes**  | Zero-based index of the correct option. `0` = first option, `1` = second, etc. |
| `explanation` | string  | No       | Shown after the user answers. Useful for teaching the reasoning behind the correct answer |

### Notes

- Questions are **shuffled** in a random order each time a test is started.
- The `answer` index always refers to the option position **in the original unshuffled array**, not the displayed order. The app handles remapping automatically.
- There is no limit on the number of questions per file.
- Files are validated when imported or loaded; any structural error will show a descriptive message.

## Importing a Custom Test

Click **Import JSON** on the home screen and either click to browse or drag and drop a `.json` file onto the dialog. The test is validated immediately and added to the **My Tests** section. Custom tests persist only for the current session — they are not saved to disk.

If you import a file with the same `title` as an existing custom test, it will be replaced.

## Adding an Official Test

1. Create a new `.json` file following the format above.
2. Place it inside `local-tests/` (or any subfolder you prefer).
3. Add an entry to `manifest.json` pointing to the file.
4. Commit and push — the test will appear automatically on the next page load.