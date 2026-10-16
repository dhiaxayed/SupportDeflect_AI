# Linux VM Setup

## Fixed Provisioning Choice

Manually install Ubuntu Server 24.04 LTS x86_64 in the available hypervisor.
Start with 4 vCPU, 8 GB RAM and 60 GB disk; these are planning sizes, not load-test guarantees.
The local model is MiniLM, not a local 70B language model. Groq handles LLM inference.

Set a stable bridged LAN address, or explicitly forward SSH and proxy ports in NAT.
Record hypervisor, VM name, OS release, IP, resources and chosen source revision in the acceptance report.
Do not publish database, API, frontend-development or SMTP ports.
Install security updates, configure a non-root operator and SSH keys.
Docker-group membership is root-equivalent; grant it deliberately or use sudo.

## Install Docker

Follow [Docker's official Ubuntu installation procedure](https://docs.docker.com/engine/install/ubuntu/)
for the Engine, CLI, Buildx and Compose plugin. Do not mix distribution docker.io packages with
the official package set. Verify:

```bash
cat /etc/os-release
uname -a
ip -br address
df -h
free -h
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

The official firewall caveats matter: published Docker ports are not controlled by UFW alone.
Restrict access at the hypervisor/router and Docker-aware firewall layer. Use only an isolated
lab network for HTTP; use the TLS overlay before sending real passwords on an untrusted network.

## Obtain the Approved Source

```bash
read -r -p "Repository URL: " REPOSITORY_URL
read -r -p "Approved commit/tag: " RELEASE_REF
git clone "$REPOSITORY_URL" "$HOME/SupportDeflect_AI"
cd "$HOME/SupportDeflect_AI"
git checkout --detach "$RELEASE_REF"
git status --short
python3 scripts/configure.py --url http://YOUR_VM_IP
chmod 600 .env
nano .env
```

Set the Groq key and an account-accessible model. PUBLIC_URL must be the browser-visible origin.
TRUSTED_HOSTS contains hostnames/IPs without scheme or path; CORS_ORIGINS=[] is correct for
same-origin administration through Traefik. Avoid an EDGE_SUBNET collision with existing networks.
The generator preserves an existing .env; never overwrite production secrets blindly.

## Start and Verify

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps --all
docker compose logs --tail=100 migrate backend worker mailer
docker compose exec backend python scripts/create_super_admin.py
curl -f http://localhost/login
curl -f http://localhost/api/v1/widget/script.js -o /dev/null
docker compose exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/healthz/db').read().decode())"
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version_num FROM alembic_version;"'
```

Expected: migration 0006; migrate exits 0; persistent services running/healthy; only Traefik
has host-published ports. Visit PUBLIC_URL/login from another machine and PUBLIC_URL/mail/
using Mailpit credentials. Show the local mailer state in Super Admin communications.

Perform the [runbook demonstration](RUNBOOK.md#presentation-checklist), down/up persistence
and disposable restore drill. Record observed results, not expected output.

```bash
python3 scripts/verify_stack.py --exercise --state logs/stack-state.json --report logs/vm-initial.json
python3 scripts/verify_stack.py --state logs/stack-state.json --restart --allow-interruption --report logs/vm-restart.json
# At an agreed downtime, reboot the VM, reconnect and return to this checkout.
python3 scripts/verify_stack.py --state logs/stack-state.json --report logs/vm-after-reboot.json
```

For TLS, export COMPOSE_FILE and use --ca-file as described in RUNBOOK.md. The state file is private;
only share the report JSON. Retain VM identity, OS/IP/resources, approved Git revision, three reports,
restore rehearsal result and browser/real-Groq evidence for the professor. Any failed check keeps
the infrastructure checkpoint open.

On 2 October 2026, the user confirmed that no VM exists yet. Hyper-V services are available on the
Windows host, but there is no registered VM, no WSL distribution and no Docker Engine/CLI. Creating
the target Linux VM and executing these commands is still required; this page does not claim it
has already been done.
