# AGENTS.md

**Идея проекта:** [docs/pi_polza_provider_architecture.md](docs/pi_polza_provider_architecture.md)

Мы делаем `pi-polza` — полноценный динамический провайдер моделей Polza AI для Pi Agent (не просто OpenAI-compatible endpoint): автозагрузка каталога моделей, определение capabilities (context, vision, reasoning, tools), pricing с раздельным учётом USD и нативных RUB, медиа-инструменты и основа для model routing.
