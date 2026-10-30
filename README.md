# Purikura Studio

A React + TypeScript + Vite browser photo booth.

## Run locally

Install Node.js 20+ and run:

```bash
npm install
npm run dev
```

Open the local URL shown by Vite (normally http://localhost:5173) and allow camera access. Camera access requires HTTPS or localhost in supported browsers.

## Features

- Home → Welcome → Choose Layout → Camera → Preview
- Four layouts (the Dream Grid layout captures four photos; the other layouts capture two)
- Four live preview filters, applied again during photo composition export
- Countdown from 1–10 seconds
- Camera selection when multiple video devices are available
- Stickers, frames, PNG export, animated GIF export, and a QR code linking to the studio website

Captured photos stay in browser memory and are not uploaded to a server. The QR code links to the website, not to the photo file.

## Camera troubleshooting

- Click **Open camera** on the Camera screen and allow access in the browser permission prompt.
- If the camera is blocked, use the camera/site-permission icon beside the address bar and allow access.
- Close other apps that may be using the webcam.
- On Windows, check Settings → Privacy & security → Camera.
- Use `http://localhost:5173` or an HTTPS deployment; ordinary HTTP on a LAN address generally cannot access the camera.
