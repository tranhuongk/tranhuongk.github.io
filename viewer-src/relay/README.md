# uv-relay — self-hosted pipe for the web viewer

Same wire protocol as `../worker` (`GET /tcp?ip=<public IPv4>&port=443`, subprotocol `uvpipe`,
close codes 4403 / 4429 / 4502 / 1003 / 1000), but runs as a plain Node process behind Caddy, so
there is no Workers free-plan CPU kill (`exceededCpu`) and a closed pipe frees its slot at once.

- `relay.mjs` — the relay (one dependency: `ws`). Listens on `127.0.0.1:8080`; `/healthz` → `ok <live pipes>`.
- `setup-vm.sh` — installs Node, Caddy (auto Let's Encrypt on `<ip>.sslip.io`), a systemd unit and
  the host firewall rule on Ubuntu 24.04+. Safe to re-run to update.
- `deploy.sh` — copies the files to a VM over SSH and runs `setup-vm.sh`.

## Oracle Cloud Always Free

1. Create an account at cloud.oracle.com (card needed for verification; Always Free shapes are not charged).
   Pick a home region close to the users (Singapore or Tokyo); it cannot be changed later.
2. Compute → Instances → Create: image **Canonical Ubuntu 24.04**, shape **VM.Standard.A1.Flex**
   (1 OCPU / 6 GB is plenty) or **VM.Standard.E2.1.Micro**. Download the generated SSH private key.
3. Networking → the instance's subnet → Security List → Add ingress rules:
   source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
4. From this folder: `bash deploy.sh <public-ip> <path-to-private-key>`.
   It prints `Relay URL for the viewer: wss://<ip-dashed>.sslip.io`.
5. Point the viewer at it: set `PROD_WORKER_URL` in `../src/config.ts`, rebuild, publish.
   (To try first without publishing, paste the URL into the viewer's Diagnostics → Worker field.)

After the 30-day trial the account stays active and Always Free instances keep running, as long as
A1 usage stays within 2 OCPU / 12 GB in total (above that, every A1 instance is disabled, then
deleted after 30 days). Oracle may reclaim an Always Free instance that is idle for 7 days
(95th-percentile CPU, network and, on A1, memory all under 20%); check the instance after a quiet week.

## Ops

```bash
journalctl -u uv-relay -f      # relay log (no IPs or payload are logged)
journalctl -u caddy -n 50      # TLS / certificate issues
curl https://<host>/healthz    # ok <live pipes>
```
