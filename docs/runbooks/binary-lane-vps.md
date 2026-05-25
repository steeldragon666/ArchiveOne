# ArchiveOne Binary Lane VPS Runbook

Production host:

- Hostname: `server.archiveone.com.au`
- Public IP: `175.45.180.181`
- OS: Ubuntu 24.04 LTS
- Domain: `archiveone.com.au`

DNS records:

```txt
archiveone.com.au        A  175.45.180.181
www.archiveone.com.au    A  175.45.180.181
server.archiveone.com.au A  175.45.180.181
```

Keep Titan email DNS in place:

```txt
archiveone.com.au MX 10 mx1.titan.email
archiveone.com.au MX 20 mx2.titan.email
archiveone.com.au TXT v=spf1 include:spf.titan.email ~all
titan1._domainkey.archiveone.com.au TXT v=DKIM1; ...
```

First deploy:

```bash
ssh root@175.45.180.181
passwd
curl -fsSL https://raw.githubusercontent.com/steeldragon666/ArchiveOne/main/deploy/ubuntu-deploy.sh | bash
```

Update deploy:

```bash
ssh root@175.45.180.181
cd /opt/archiveone
git pull --ff-only
docker compose --env-file .env.production -f compose.prod.yml build
docker compose --env-file .env.production -f compose.prod.yml --profile tools run --rm migrate
docker compose --env-file .env.production -f compose.prod.yml up -d
```

Smoke checks:

```bash
curl -I https://archiveone.com.au
curl -fsS https://archiveone.com.au/healthz
docker compose --env-file .env.production -f compose.prod.yml ps
docker compose --env-file .env.production -f compose.prod.yml logs --tail=100 api
```
