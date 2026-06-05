# Inertia Rails Best Practices Skill

A comprehensive Claude Code skill for building high-quality Inertia.js applications with Ruby on Rails.

## Overview

This skill provides 50+ best practices and patterns for Inertia Rails development, organized into 8 categories:

1. **Server-Side Setup & Configuration** (CRITICAL)
2. **Props & Data Management** (CRITICAL)
3. **Forms & Validation** (HIGH)
4. **Navigation & Routing** (HIGH)
5. **Performance Optimization** (MEDIUM-HIGH)
6. **Security** (MEDIUM-HIGH)
7. **Testing** (MEDIUM)
8. **Advanced Patterns** (MEDIUM)

## Installation

### For a Single Project

Copy the skill files to your project's `.claude/skills/` directory:

```bash
mkdir -p .claude/skills
cp -r inertia-rails-best-practices .claude/skills/
```

### For Personal Use

Copy to your personal Claude skills directory:

```bash
cp -r inertia-rails-best-practices ~/.claude/skills/
```

## Available Skills

This package includes multiple focused skills:

| Skill | Description |
|-------|-------------|
| `inertia-rails-best-practices` | Comprehensive best practices reference |
| `inertia-rails-setup` | Project setup and configuration |
| `inertia-rails-forms` | Form handling and validation |
| `inertia-rails-testing` | RSpec and Minitest testing |
| `inertia-rails-auth` | Authentication and authorization |
| `inertia-rails-performance` | Performance optimization |

## Usage

The skill activates automatically when Claude Code detects Inertia Rails related tasks. You can also invoke it directly:

```
/inertia-rails-best-practices
/inertia-rails-setup react --typescript --tailwind
/inertia-rails-forms
/inertia-rails-testing
/inertia-rails-auth
/inertia-rails-performance
```

## Structure

```
inertia-rails-best-practices/
├── SKILL.md                    # Main skill definition
├── README.md                   # This file
├── references/
│   └── AGENTS.md               # Detailed rules and examples
└── scripts/
    └── setup.sh                # Project setup automation
```

## Resources

- [Inertia Rails Documentation](https://inertia-rails.dev/)
- [Inertia.js Documentation](https://inertiajs.com/)
- [GitHub: inertiajs/inertia-rails](https://github.com/inertiajs/inertia-rails)

## Contributing

Contributions are welcome! Please submit issues and pull requests for:

- New best practices
- Bug fixes in examples
- Additional patterns and use cases
- Framework-specific examples (React, Vue, Svelte)

## License

MIT License
