# Purikura Studio

A React + TypeScript + Vite browser photo booth.

## Run locally

Install Node.js 20+ and run:

```bash
npm install
npm run dev
```

Open the local URL shown by Vite (normally http://localhost:5173) and allow camera access. Camera access requires HTTPS or localhost in supported browsers.

## Supabase sharing setup

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. The anon key is used only to call Edge Functions; the browser does not access database tables or Storage directly. Never put a `service_role` key in frontend configuration.

Apply the migrations in `supabase/migrations` in order, then deploy the `share` and `cleanup-shares` Edge Functions. The first migration creates the private `purikura-shares` bucket and gallery table. The Edge Functions use the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets; do not expose the service-role key to the client.

Configure `CLEANUP_SECRET` as an Edge Function secret. `cleanup-shares` disables gateway JWT verification and authenticates each call with that secret in the `x-cleanup-secret` header. Schedule it to run periodically (for example, hourly) from Supabase Cron or an external scheduler. The cleanup job removes expired galleries and uploads stuck in `uploading` for over an hour, using a short database status claim so retries and cleanup cannot delete the same active upload. Configure the web host to serve the SPA entry point for `/share/`.

The share QR contains a cryptographically random 256-bit token in the URL fragment. Only its SHA-256 hash is stored in the database. The Edge Function checks the gallery's seven-day expiry on every lookup and returns private Storage signed URLs that expire no later than the gallery.

## Features

- Home → Welcome → Choose Layout → Camera → Preview
- Four layouts (the Dream Grid layout captures four photos; the other layouts capture two)
- Four live preview filters, applied again during photo composition export
- Countdown from 1–10 seconds
- Camera selection when multiple video devices are available
- Stickers, frames, and local PNG/GIF downloads
- Private seven-day gallery sharing by QR code, with PNG and GIF downloads

Camera capture and local downloads remain browser-side. Creating a share QR uploads the composed PNG and GIF to the private Supabase bucket.

## Camera troubleshooting

- Click **Open camera** on the Camera screen and allow access in the browser permission prompt.
- If the camera is blocked, use the camera/site-permission icon beside the address bar and allow access.
- Close other apps that may be using the webcam.
- On Windows, check Settings → Privacy & security → Camera.
- Use `http://localhost:5173` or an HTTPS deployment; ordinary HTTP on a LAN address generally cannot access the camera.
