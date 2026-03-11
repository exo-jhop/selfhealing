# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
```bash
composer run setup   # Full setup: install deps, copy .env, generate key, migrate, npm install + build
```

### Development
```bash
composer run dev     # Concurrent: php artisan serve + queue:listen + pail (logs) + npm run dev (Vite)
```

### Testing
```bash
composer run test           # Clear config cache + run all PHPUnit tests
php artisan test --filter TestName   # Run a single test or test class
php artisan test tests/Feature/ExampleTest.php  # Run a specific file
```

### Other useful commands
```bash
php artisan migrate          # Run migrations
php artisan tinker           # Interactive REPL
php artisan pail             # Stream logs in real-time
./vendor/bin/pint            # Fix code style (Laravel Pint)
npm run build                # Production frontend build
```

### Docker (Sail)
```bash
./vendor/bin/sail up -d      # Start containers (PHP 8.5 + MySQL 8.4)
./vendor/bin/sail artisan migrate
```

## Architecture

This is a **Laravel 12** application (PHP ^8.2) in early/skeleton stage. The app name/database is `selfhealing`.

### Stack
- **Backend**: Laravel 12, PHP 8.2+
- **Frontend**: Vite 7 + Tailwind CSS 4, Axios
- **Database**: MySQL (via Docker/Sail) or SQLite for local dev; database-backed sessions, cache, and queue
- **Testing**: PHPUnit 11 with Feature and Unit suites

### Key packages
- `laravel/nightwatch` — production monitoring/observability (config at `config/nightwatch.php`; disabled in tests via `NIGHTWATCH_ENABLED=false`)
- `laravel/boost` — AI-assisted development acceleration
- `laravel/pail` — real-time log viewer
- `laravel/sail` — Docker environment

### Bootstrap & routing
The app uses Laravel 12's functional bootstrap style (`bootstrap/app.php`):
- Web routes: `routes/web.php`
- Console commands: `routes/console.php`
- Health endpoint: `/up` (built-in)
- No API routes configured yet

### Frontend
Entry points are `resources/css/app.css` (Tailwind 4 with `@import 'tailwindcss'`) and `resources/js/app.js`. Vite handles HMR and production builds. The `@source` directives in `app.css` include vendor pagination views and Blade templates.

### Testing environment
`phpunit.xml` sets `DB_DATABASE=testing`, array cache/session/mail drivers, and `QUEUE_CONNECTION=sync`. Tests in `tests/Feature/` and `tests/Unit/`. The base `TestCase` extends Laravel's testing infrastructure.

### Local permissions
`.claude/settings.local.json` restricts Bash to `php artisan:*` and `composer:*` commands only.
