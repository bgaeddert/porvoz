# WSL browser testing

How to build and run a disposable Porvoz container in WSL and administer it from a Windows browser. Use this before releasing browser administration changes. Never point it at production data or keys.

## Why a localhost address matters

Browsers offer the microphone only in a secure context: HTTPS, or a `localhost` / `127.0.0.1` / `[::1]` address. Testing the Test page and voice prefix creation therefore needs the site opened at a localhost address, not at the machine's LAN address. Porvoz applies the same rule to sign-in, so a plain-HTTP LAN address is refused unless `PORVOZ_WEB_ALLOW_INSECURE=true`.

The container publishes its port inside WSL. Whether Windows can reach that at `localhost` depends on the WSL networking mode:

| Mode | Windows reaches the container at | Notes |
| --- | --- | --- |
| NAT with `localhostForwarding` (default) | `http://localhost:<port>` | Nothing more to do |
| Mirrored (`networkingMode=mirrored` in `.wslconfig`) | the shared LAN address | Windows loopback does not reach WSL listeners, and the WSL listener already holds the port in the shared namespace |

In mirrored mode, use the bridge in step 4 to get a localhost address.

## 1. Build the image

```bash
wsl -e bash -lc "cd /mnt/c/Users/<you>/projects/live-flow && docker build -t porvoz:web-admin-test ."
```

## 2. Run a disposable container

Use a separate volume and freshly generated keys. Publish a port the machine is not already using — an existing Porvoz container may hold 8080.

```bash
wsl -e bash -lc 'docker volume create porvoz-webadmin-test-data && docker run -d --name porvoz-web-admin-test --restart unless-stopped -e PORVOZ_ADMIN_KEY="$(openssl rand -base64 24)" -e PORVOZ_MASTER_KEY="$(openssl rand -base64 24)" -e PORVOZ_WEB_ADMIN=on -p 8090:8080 -v porvoz-webadmin-test-data:/data porvoz:web-admin-test'
```

Read back the admin key you will sign in with:

```bash
wsl -e bash -lc "docker inspect porvoz-web-admin-test --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PORVOZ_ADMIN_KEY"
```

## 3. Keep WSL running

WSL shuts the distribution down shortly after the last process exits, which stops Docker and the container with it. Leave one process open for the session:

```powershell
Start-Process -FilePath wsl.exe -ArgumentList "-e","sleep","infinity" -WindowStyle Hidden
```

Check the container is up: `wsl -e bash -lc "curl -s http://127.0.0.1:8090/health"`.

## 4. Reach it from Windows at a localhost address

In mirrored networking mode, forward a Windows localhost port to the container. This changes no system settings and needs no administrator rights:

```bash
node scripts/wsl-localhost-bridge.js --port 8091 --target-port 8090
```

Leave it running and open `http://localhost:8091`. Stop it with Ctrl+C when finished. In NAT mode you can skip this and open `http://localhost:8090` directly.

## 5. What to check

1. `/` shows the sign-in page with one Admin key field and no user name. A wrong key is refused; the correct key opens Provider.
2. Signed out, `/settings.html`, `/logs.html`, `/index.html`, `/test`, `/capture`, `/activity`, `/settings`, `/prefixes`, and `/provider` return to sign-in with an explanation, then land on the requested page after signing in.
3. The sidebar lists Provider, Prefixes, then Test and Activity, then Log out — no settings sub-menu. Log out asks before it ends the session: Stay signed in keeps it, and confirming returns to sign-in with the protected pages protected again. Narrow the window below about 820px and the sidebar becomes a labelled bar across the bottom, with no horizontal scrolling down to 320px.
4. Keyboard, Sound, Console selection, and the Porvoz server card are absent, and `#keyboard` or `#sound` in the address bar falls back to Prefixes. `#capture` also falls back to Prefixes, since that identifier was renamed.
5. `/status-overlay.html` is not served.
6. Provider profiles, connection saving, model loading, prefix editing, prefix import and export, and inference-key copy and rotation all work. Changing the selected profile in the browser does not change what a connected desktop is using.
7. Test requests microphone permission, records, stops, transcribes, applies a prefix, and shows the result with working Copy. Nothing is typed into other applications and no clipboard content reaches the request.
8. Voice prefix creation requests permission, records, stops, shows a draft, and saves only after you confirm. Denying permission, cancelling, and closing the dialog all release the microphone.
9. Activity lists events, refreshes when the tab regains focus, and clears after confirming — with wording that says the clear affects the whole server.
10. Reset to defaults warns that it affects every client of this server.
11. At phone width, every dialog fits without horizontal scrolling and stacks its buttons full width: log out, reset, clear activity, add and edit prefix, the voice draft, new and delete profile, and the model picker.

To see the insecure-HTTP behavior, open the LAN address instead: sign-in is refused, and with `PORVOZ_WEB_ALLOW_INSECURE=true` administration works while both recording controls stay disabled and explain why.

## 6. Clean up

```bash
wsl -e bash -lc "docker rm -f porvoz-web-admin-test && docker volume rm porvoz-webadmin-test-data"
```

Stop the bridge with Ctrl+C, and close the keep-alive process (`Get-Process wsl | Stop-Process`) if you started one only for this.
