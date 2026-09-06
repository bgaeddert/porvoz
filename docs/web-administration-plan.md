# Browser administration plan

Status: implemented and covered by automated tests; awaiting the first browser
testing pass described below. See [WSL browser testing](wsl-browser-testing.md)
for the procedure and [server setup](server-setup.md#browser-administration)
for the shipped configuration.

Two naming decisions were made after this plan was written and apply wherever it
says otherwise. The Capture page is now called **Test**, because checking that
transcription and prefixes work is what it is for. And there is no Settings
sub-menu: Provider, Prefixes, Keyboard, and Sound are top-level destinations in
both the desktop app and the website, with Test and Activity below them, and
Porvoz opens on Provider rather than on Settings. The settings page identifier
`capture` became `prefixes`; the old name still resolves to it.

## Objective

Add a browser administration website to the Porvoz Docker image. Reuse the
existing Capture, Settings, and Activity UI where practical, while keeping desktop-only
features in the Electron app. The website administers only the Porvoz server
hosting it.

The first testing pass will build and run the Docker container in WSL, then
connect to it from the local Windows browser. Release and Dreamfyre deployment
follow successful testing and review as a separate step.

## Login and navigation

- Visiting `/` shows Porvoz branding, one **Admin key** password field, and
  **Sign in**. There is no username.
- Successful login opens Settings on the Prefixes page. An existing valid
  session goes directly there.
- Website navigation contains **Capture**, **Settings**, **Activity**, and **Log out**.
- Keep `/` as the login entry point and serve Capture at a separate authenticated
  route, such as `/capture`.
- Direct links to administration pages require authentication. An expired
  session returns the user to login, with a clear explanation.
- All administration requests use the website's own origin. There is no
  configurable Porvoz server URL or local/remote backend switch.

## Feature scope

| Feature | Browser administration behavior |
| --- | --- |
| Provider profiles, credentials, and models | Keep |
| Prefix editing and manual creation | Keep |
| Prefix import and export | Keep |
| Create a prefix with your voice | Keep when browser microphone access is available |
| Inference key viewing, copying, and rotation | Keep |
| Activity viewing, copying, refreshing, and clearing | Keep |
| Reset server settings | Keep, clearly labeled as affecting all connected clients |
| Capture page and ordinary dictation | Keep; recording follows the same microphone availability rules as voice prefix creation |
| Porvoz server switching and local/remote backend mode | Omit |
| Keyboard and global hotkey settings | Omit |
| Console-selection setting | Omit |
| Recording sounds, previews, and sound settings | Omit |
| Desktop overlays and response panels | Omit |
| Automatic clipboard or selected-text capture | Omit |
| Typing or pasting into other applications | Omit |

Provider profile selection remains available: changing which provider profile
the administrator is editing is different from switching Porvoz servers. The
browser remembers its selected profile independently of desktop clients.

Reset and Clear Activity retain explicit confirmation. Their wording describes
the shared server data affected; browser reset does not claim to change any
desktop's hotkey, sound, or console-selection preferences.

Browser Capture records and displays results within the website. It does not
type into other applications, execute returned keyboard notation, or capture
the user's clipboard or selected text automatically. Existing transcription
API access for desktop and other compatible clients remains intact.

## Microphone access for Capture and voice prefix creation

The browser uses the microphone on the computer visiting the website, not an
audio device on the Docker host. The container does not need microphone device
passthrough.

### Availability

Check all three capabilities before enabling recording:

- `window.isSecureContext`.
- `navigator.mediaDevices?.getUserMedia`.
- `MediaRecorder` support, including a suitable recording format.

Use one shared capability check and explanation for both Capture and voice
prefix creation. HTTPS and supported localhost connections can offer recording
in either flow. Ordinary remote HTTP disables both recording entry points and
explains that they require HTTPS or localhost. The authenticated Capture page
remains accessible with its recording controls disabled and the explanation
visible. Manual prefix creation and other administration features remain
available when HTTP administration is explicitly configured.

A secure context makes microphone access eligible; the browser must still grant
permission. Handle browser or operating-system restrictions even when the
capability checks pass. See [MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)
and [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

### Capture flow

1. The administrator opens **Capture** and chooses the provider profile to use.
2. Clicking **Start recording** requests audio-only microphone permission.
3. The page shows recording status and a Stop control.
4. Stopping releases the microphone and sends the recording to the same server
   using the authenticated browser session and selected provider profile.
5. Display the raw transcription and any instruction response in the page,
   preserving existing prefix processing. Offer explicit Copy controls and
   selectable text for the result.

Browser Capture uses on-page controls rather than global hotkeys. Returned
keyboard notation is displayed as text and never injected into the browser or
other applications. Recording does not read clipboard or selection context;
prefixes that permit clipboard context receive no browser clipboard content
unless a separate explicit context-input feature is designed later.

### Voice prefix creation flow

1. The administrator chooses **Create a prefix with your voice**.
2. Clicking **Start listening** requests audio-only microphone permission.
3. The page shows recording status and a Stop control.
4. Stopping releases the microphone and sends the recording to the existing
   authenticated voice-prefix endpoint on the same server, using the selected
   provider profile.
5. The server returns a draft. The administrator reviews and edits its trigger
   and instruction before explicitly adding it.

Neither flow begins recording automatically on login or page load. Only one
recording flow may run at a time within the page. Do not save a draft as a
prefix until the administrator confirms it.

### Errors and cleanup

- Explain denied permission, missing or busy microphones, unsupported recording
  formats, and failed or oversized uploads.
- Preserve the existing handling of empty or too-short recordings.
- Bound recordings to respect the server's upload limit.
- Stop all media tracks on Stop, Cancel, dialog close, logout, navigation, or
  recording failure. If a permission request resolves after cancellation,
  immediately release the resulting stream.
- Apply the same cleanup rules to Capture and voice prefix creation, including
  session expiration. Cancel in-progress transcription or draft requests when
  their flow is canceled. Discard late results so they cannot update a closed
  or superseded page or dialog.
- Configure browser permissions policy to allow this site's microphone use
  without granting microphone access to unrelated origins.

## Authentication and sessions

- Validate the submitted admin key on the server and exchange it for a random
  session token.
- Store the token in an HttpOnly session cookie. Do not retain the admin key in
  browser local storage, URLs, or logs.
- Use Secure cookies for HTTPS, an appropriate SameSite policy, and server-side
  protection against forged browser requests for state-changing operations.
- Add logout, bounded login rate limiting, and session expiration.
- Proposed defaults: a one-hour idle timeout and an eight-hour maximum session
  lifetime. Server restart invalidates sessions.
- Explicitly configure trusted-LAN HTTP administration and localhost
  development behavior. Remote HTTP does not enable browser recording.
- Handle HTTPS termination at a reverse proxy correctly. Only trust forwarded
  connection information from explicitly trusted proxies.
- Enforce authentication on administration routes and data at the server;
  hiding navigation is not access control. Only the login page and the minimal
  assets needed to render it are public website resources.
- Preserve the existing unauthenticated `/health` endpoint for health checks.
- Preserve bearer-key authentication for desktop and inference clients.
  Inference keys must never grant administration-site access.
- Allow authenticated browser sessions to use Capture's transcription endpoint
  with the selected provider profile and browser request protections. Preserve
  the existing profile-routing rules for bearer-key API clients.

Session implementation should follow [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
and [CSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Shared UI and server integration

- Introduce a shared application interface that routes desktop operations
  through Electron and browser operations through same-origin HTTP requests.
- Represent available features explicitly. The browser must not masquerade as
  Electron to bypass existing desktop checks.
- Adapt runtime configuration validation, version display, settings loading,
  profile selection, and error handling for each environment.
- Keep existing desktop capture, hotkeys, preferences, clipboard transactions,
  and overlays intact.
- Serve an explicit allowlist of website assets, including authenticated
  Capture. Desktop overlay pages remain unavailable even when requested
  directly; do not expose arbitrary project or filesystem paths.
- Apply suitable cache and security headers to login, administration pages,
  assets, and authenticated responses.
- Use browser clipboard APIs only for explicit Copy or Import actions. Provide
  selectable text or a paste field when those APIs are unavailable or denied,
  including on HTTP connections.
- Refresh Activity without depending on Electron notifications. Keep existing
  entries visible if a refresh fails and distinguish an error from an empty
  history.

## Docker and documentation

- Include the administration UI assets in the Docker image and serve them from
  the existing HTTP server and port. No separate frontend service is needed.
- Keep web administration disabled in the desktop's private child server.
- Preserve existing database volumes, environment variables, API compatibility,
  and health checks.
- Update the README and server setup/API documentation with the website URL,
  admin-key login, session behavior, trusted HTTP configuration, HTTPS proxy
  setup, microphone requirements for Capture and voice prefix creation, browser
  Capture's on-page output behavior, and shared-server effects of destructive
  actions.
- Document the WSL development and testing procedure, including access from a
  Windows browser and the localhost secure-context exception.

## First testing pass: Docker in WSL, browser on Windows

This is the first testing pass, before the remaining validation and release
work.

1. Build the updated Docker image in WSL.
2. Run a test container using a separate database volume, test admin key, and
   test master key. Publish its port so the local Windows browser can reach it.
   Do not reuse Dreamfyre's production data or keys.
3. Open `http://localhost:<port>` in the Windows browser and verify that the
   connection reaches the WSL container.
4. Test login, logout, protected direct links, settings, provider profiles,
   prefixes, inference-key controls, and Activity using disposable test data.
5. Confirm Capture is available after login. Confirm server switching, Keyboard,
   Console selection, Sound, and other desktop-only features are absent and
   their pages cannot be reached directly.
6. Test Capture through localhost's secure-context exception: permission
   request, recording, stopping, plain transcription, prefix-based instruction
   processing, result display, and explicit Copy. Confirm it does not type into
   other applications or automatically capture clipboard or selection context.
7. Test voice prefix creation under the same rules: permission request,
   recording, stopping, draft review, and explicit save. Confirm denied
   permission, cancellation, session expiration, and microphone cleanup behave
   correctly in both flows.
8. Check browser clipboard actions and their fallback controls.
9. Fix issues from this pass before completing the remaining automated checks
   and final review.

## Remaining validation and completion criteria

- Add automated server tests for login/logout, session expiration, rate
  limiting, unauthorized access, inference-key rejection, browser request
  protections, and blocked desktop-only routes.
- Add browser coverage for authenticated Capture, transcription and instruction
  result display, navigation, profile isolation, settings operations, Activity
  errors, and clipboard fallbacks.
- Use mocked browser media to cover secure/insecure availability, missing
  recorder support, permission failures, cancellation, and media-track cleanup
  in both Capture and voice prefix creation. Verify that disabled recording
  controls do not request microphone access or submit audio.
- Validate remote HTTPS and explicitly enabled HTTP behavior separately;
  localhost success alone does not prove remote HTTPS proxy configuration.
- Run the full existing test suite and verify desktop behavior remains intact.
- Complete Docker build and health checks, code review, static checks, and
  documentation review.
- The website must administer only its own server; unavailable desktop
  functionality must not be reachable through the website; microphone access
  must be explicit and supported by the browser security context; existing API
  clients must continue to work.
- Prepare the implementation and test results for review. A subsequent release
  and Dreamfyre deployment are separate from this planning task and the initial
  WSL testing pass.
