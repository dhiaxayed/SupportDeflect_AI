# Deployment

The single supported full-stack deployment is docker-compose.yml at the repository root.
Use the optional docker-compose.tls.yml overlay for HTTPS; it is not a second application stack.

1. Provision the manually installed Linux VM: [VM_SETUP.md](VM_SETUP.md).
2. Configure independent secrets, public origin and Groq model/key: [README](../README.md).
3. Start via docker compose up -d --build and bootstrap the platform administrator.
4. Complete runtime, widget, SMTP, persistence and restore checks: [RUNBOOK.md](RUNBOOK.md).
5. Record evidence against [PROFESSOR_REQUIREMENTS.md](PROFESSOR_REQUIREMENTS.md).

CI builds and tests only. Deployment, migration acceptance, rollback and source publication remain
explicit operator decisions. Native Windows/SQLite checks are useful development evidence,
but cannot substitute for the teacher's real Linux VM/PostgreSQL/Compose checkpoint.
