# Contributing to MeetVault

Thank you for your interest in improving MeetVault! As an open-source, community-driven project, contributions from developers of all skill levels are welcome.

---

## How to Contribute

### 1. Reporting Bugs
- If Google Meet updates its internal UI classes or changes its caption layout, open an issue with:
  - Your browser version and OS.
  - A screenshot or DOM snippet of the caption elements (inspect element on Google Meet).
  - Any error messages in the Chrome extension developer console (`chrome://extensions` -> Inspect background service worker or Inspect on the Meet tab).

### 2. Feature Requests & Improvements
Suggestions for enhancements (e.g., additional export formats, enhanced search within transcripts, theme customizations) can be opened as GitHub Issues or Pull Requests.

### 3. Submitting Code Changes
1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/MeetVault.git
   cd MeetVault
   ```
3. Create a descriptive feature branch:
   ```bash
   git checkout -b feature/fast-caption-sync
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Implement your changes and verify the build passes without errors:
   ```bash
   npm run build
   ```
6. Commit your changes and open a Pull Request explaining the reasoning behind your fix or feature.

---

## Code Guidelines

- **Zero Cloud / Zero API**: All functionality must execute locally within the user's browser. No remote servers or external data collection.
- **Manifest V3 Compatibility**: All background tasks must run within standard service workers, and content scripts must build to IIFE format without ES module export statements.
- **Performance**: Use requestAnimationFrame or throttled timeouts when observing DOM changes to keep CPU and memory overhead minimal during long meetings.
