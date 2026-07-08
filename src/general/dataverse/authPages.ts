// Branded HTML pages served on the MSAL loopback redirect after interactive sign-in.
// These are what the user sees in the browser tab once the flow completes, so give
// them a friendly Dataverse PowerTools look. Fully self-contained (inline CSS + logo).

// The extension logo (media/logo_new.svg) inlined and recoloured to currentColor.
const LOGO_SVG = `<svg viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg" width="34" height="34" aria-hidden="true">
  <style>.st0{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:10;}</style>
  <ellipse class="st0" cx="14" cy="8" rx="10" ry="5"/>
  <g>
    <ellipse cx="14" cy="8" rx="11" ry="6"/>
    <path d="M14,24c-4.8,0-8.8-1.4-11-3.6V24c0,3.4,4.8,6,11,6c0.9,0,1.8-0.1,2.7-0.2C15.2,28.3,14.3,26.2,14,24z"/>
    <path d="M3,12.4V16c0,3.4,4.8,6,11,6c0,0,0,0,0.1,0c0.2-2.4,1.4-4.6,3-6.2c-1,0.1-2,0.2-3.1,0.2C9.2,16,5.2,14.6,3,12.4z"/>
  </g>
  <path d="M31.7,20.9c-0.1-0.5-0.7-0.8-1.2-0.7c-0.7,0.2-1.2,0-1.3-0.2c-0.1-0.2,0-0.7,0.5-1.3c0.4-0.4,0.4-1,0-1.4c-1-1-2.2-1.7-3.6-2.1c-0.5-0.1-1.1,0.2-1.2,0.7c-0.2,0.7-0.6,1-0.9,1s-0.6-0.4-0.9-1c-0.2-0.5-0.7-0.8-1.2-0.7c-1.4,0.4-2.6,1.1-3.6,2.1c-0.4,0.4-0.4,1,0,1.4c0.5,0.5,0.6,1,0.5,1.3c-0.1,0.2-0.6,0.4-1.3,0.2c-0.5-0.1-1.1,0.2-1.2,0.7C16.1,21.6,16,22.3,16,23s0.1,1.4,0.3,2.1c0.1,0.5,0.7,0.8,1.2,0.7c0.7-0.2,1.2,0,1.3,0.2c0.1,0.2,0,0.7-0.5,1.3c-0.4,0.4-0.4,1,0,1.4c1,1,2.2,1.7,3.6,2.1c0.5,0.1,1.1-0.2,1.2-0.7c0.2-0.7,0.6-1,0.9-1s0.6,0.4,0.9,1c0.1,0.4,0.5,0.7,1,0.7c0.1,0,0.2,0,0.3,0c1.4-0.4,2.6-1.1,3.6-2.1c0.4-0.4,0.4-1,0-1.4c-0.5-0.5-0.6-1-0.5-1.3c0.1-0.2,0.6-0.4,1.3-0.2c0.5,0.1,1.1-0.2,1.2-0.7c0.2-0.7,0.3-1.4,0.3-2.1S31.9,21.6,31.7,20.9z M24,26c-1.7,0-3-1.3-3-3s1.3-3,3-3s3,1.3,3,3S25.7,26,24,26z"/>
</svg>`;

function page(options: { accent: string; badge: string; heading: string; message: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dataverse PowerTools</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #3b2a6b 0%, transparent 60%), linear-gradient(160deg, #1b1030 0%, #0e0b1a 100%);
    color: #f4f2fb; padding: 24px;
  }
  .card {
    width: 100%; max-width: 440px; background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10); border-radius: 22px; padding: 40px 36px;
    text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,0.45); backdrop-filter: blur(6px);
  }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: #c9b8ff; font-weight: 600; font-size: 13px; letter-spacing: .3px; text-transform: uppercase; margin-bottom: 26px; }
  .brand .logo { display: inline-flex; width: 44px; height: 44px; align-items: center; justify-content: center; border-radius: 13px; background: linear-gradient(150deg, #8e5bff, #5b8cff); color: #fff; box-shadow: 0 8px 24px rgba(120,80,255,0.45); }
  .status { width: 66px; height: 66px; border-radius: 50%; margin: 0 auto 22px; display: flex; align-items: center; justify-content: center; background: ${options.accent}22; border: 2px solid ${options.accent}; color: ${options.accent}; font-size: 32px; }
  h1 { margin: 0 0 10px; font-size: 22px; font-weight: 650; }
  p { margin: 0; color: #b9b4cc; font-size: 15px; line-height: 1.55; }
  .hint { margin-top: 22px; font-size: 13px; color: #8a85a3; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand"><span class="logo">${LOGO_SVG}</span> Dataverse PowerTools</div>
    <div class="status">${options.badge}</div>
    <h1>${options.heading}</h1>
    <p>${options.message}</p>
    <div class="hint">You can close this tab and return to VS Code.</div>
  </div>
</body>
</html>`;
}

export const SIGN_IN_SUCCESS_HTML = page({
  accent: "#3fb950",
  badge: "&#10003;",
  heading: "You're signed in",
  message: "Dataverse PowerTools has connected to your environment.",
});

export const SIGN_IN_ERROR_HTML = page({
  accent: "#f85149",
  badge: "&#10005;",
  heading: "Sign-in didn't complete",
  message: "Something interrupted the sign-in. Head back to VS Code and try connecting again.",
});
