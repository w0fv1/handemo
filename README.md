# Hand Tracking (MediaPipe) + Node.js

## Run

```bash
npm install
npm start
```

Open the `HTTP:` URL printed in the terminal and click **Start**.

If `3000` is already in use, the server will automatically try the next ports (or you can pick one):

- PowerShell: `$env:PORT=3001; npm start`
- PowerShell: `$env:PORT=3001; pnpm start`

## What you get

- Browser runs MediaPipe Hands and extracts 21 landmarks per hand.
- Computes the **index fingertip** position and motion (`dx`, `dy`, `speedPxPerS`) in pixels.
- All processing stays in the browser; the backend only serves the web page.
- MediaPipe runtime assets are vendored under `public/vendor/mediapipe/` to avoid CDN blocking and reduce first-load issues.
