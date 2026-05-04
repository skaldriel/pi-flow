# 🤖 Pi Agent Ecosystem

Configuración personal, extensiones, agentes y skills para el [**Pi Coding Agent**](https://github.com/mariozechner/pi-coding-agent) — un asistente de codificación inteligente en terminal.

## 📋 ¿Qué es esto?

Este repositorio contiene el *dotfiles* del ecosistema Pi: desde la configuración básica del agente hasta un sistema completo de **extensiones TUI**, **agentes especializados**, **cadenas de flujo de trabajo**, **skills reutilizables** y **equipos de agentes** orquestados.

> ⚡ Pi es un agente de codificación que opera directamente en tu terminal. Este repo extiende sus capacidades con docenas de agentes expertos y una UI personalizada.

---

## 🗂️ Estructura del repositorio

```
.pi/
├── justfile              # Comandos para lanzar Pi con diferentes configuraciones
├── settings.json         # Configuración global de Pi
├── models.json           # Modelos habilitados
├── package.json          # Dependencias (yaml, etc.)
│
├── flow-ext/             # 🎨 Extensiones TUI (terminal UI)
│   ├── minimal.ts              # Interfaz mínima: solo modelo + medidor de contexto
│   ├── pure-focus.ts           # Sin footer ni barra de estado
│   ├── tool-counter.ts         # Contador de herramientas en el footer
│   ├── tool-counter-widget.ts  # Contador de herramientas como widget
│   ├── theme-cycler.ts         # Ciclado de temas (Ctrl+X / Ctrl+Q)
│   ├── themeMap.ts             # Mapa de temas disponibles
│   ├── cross-agent.ts          # Carga comandos de .claude/, .gemini/, .codex/
│   ├── purpose-gate.ts         # Declara intención antes de trabajar
│   ├── subagent-widget.ts      # /sub <tarea> con streaming en vivo
│   ├── tilldone.ts             # Disciplina de tareas: define tareas antes de codificar
│   ├── agent-team.ts           # Orquestador de equipos con dashboard grid
│   ├── agent-chain.ts          # Pipeline secuencial de agentes
│   ├── system-select.ts        # /system para elegir personalidad del agente
│   ├── damage-control.ts       # Auditoría de seguridad post-cambio
│   ├── session-replay.ts       # Línea de tiempo interactiva del historial
│   ├── pi-pi.ts                # Meta-agente que construye agentes Pi
│   └── ...
│
├── agent/                # 🧠 Definiciones de agentes (system prompts)
│   │
│   ├── (Core)
│   ├── scout.md                # Reconocimiento rápido del codebase
│   ├── planner.md              # Planificación de implementación
│   ├── builder.md              # Implementación y generación de código
│   ├── reviewer.md             # Revisión post-desarrollo con análisis de diff
│   ├── documenter.md           # Documentación y READMEs
│   ├── red-team.md             # Seguridad y pruebas adversariales
│   ├── spec-expert.md          # Desglose de PRD/ARD/DTD en tareas atómicas
│   │
│   ├── (Especializados)
│   ├── bowser.md               # Automatización headless con Playwright
│   ├── linear.md               # Gestión de issues en Linear
│   ├── outline.md              # Exploración y edición en Outline
│   ├── planner.md, builder.md  # ..., documenter.md, red-team.md
│   │
│   ├── boletia/                # Agentes para proyectos Boletia
│   │   ├── architect.md
│   │   ├── architect-backend.md
│   │   ├── architect-frontend.md
│   │   ├── developer.md
│   │   ├── pm.md
│   │   ├── plan-reviewer.md
│   │   ├── router.md
│   │   └── outline.md
│   │
│   ├── tdd/                    # Pipeline TDD completo
│   │   ├── starter.md
│   │   ├── context-analyst.md
│   │   ├── technical-architect.md
│   │   ├── test-builder.md
│   │   ├── polisher.md
│   │   └── tech-writter.md
│   │
│   ├── pi-pi/                  # Meta-agentes expertos en Pi
│   │   ├── agent-expert.md
│   │   ├── ext-expert.md
│   │   ├── theme-expert.md
│   │   ├── skill-expert.md
│   │   ├── tui-expert.md
│   │   ├── cli-expert.md
│   │   ├── config-expert.md
│   │   ├── keybinding-expert.md
│   │   ├── prompt-expert.md
│   │   └── pi-orchestrator.md
│   │
│   ├── front/                  # Expertos en frontend
│   │   ├── front-orchestrator.md
│   │   ├── interpreter-expert.md
│   │   ├── material-ui-expert.md
│   │   ├── project-scanner-expert.md
│   │   └── react-pattern-expert.md
│   │
│   ├── extensions/             # Extensiones de agente (tools)
│   │   ├── agent-switcher.ts
│   │   ├── linear.ts
│   │   ├── outline.ts
│   │   └── web-search/
│   │
│   ├── teams.yaml              # 🏷️ Composición de equipos de agentes
│   ├── agent-chain.yaml        # 🔗 Cadenas de flujo de trabajo
│   ├── sessions/               # 📝 Historial de sesiones por proyecto
│   └── settings.json
│
├── skills/               # 🛠️ Skills reutilizables
│   ├── architect-backend/      # Pipeline completo de arquitectura backend
│   ├── architect-frontend/     # Pipeline completo de arquitectura frontend
│   ├── architecture-views/     # Vistas arquitectónicas (C4, etc.)
│   ├── general/                # Skills de propósito general
│   ├── go-master/              # Maestría en Go
│   ├── react-master/           # Maestría en React
│   ├── pm-master/              # Maestría en Project Management
│   └── post-review/            # Post-review automation
│
├── specs/                # 📐 Documentos de diseño
│   ├── agent-forge.md          # Sistema de construcción de agentes
│   ├── agent-workflow.md       # Flujos de trabajo multi-agente
│   ├── damage-control.md       # Sistema de auditoría de seguridad
│   └── pi-pi.md                # Meta-agente Pi
│
├── context/              # 📚 Contexto adicional
│   ├── adr/                    # Architecture Decision Records
│   └── session/               # Contexto de sesión
│
└── agent-sessions/       # Sesiones activas del agente
```

---

## 🚀 Cómo usar

### Lanzar Pi con diferentes configuraciones

Usa los comandos definidos en el `justfile`:

```bash
# Pi por defecto
just pi

# Modo minimalista (solo modelo + medidor de contexto)
just ext-minimal

# Modo ultra-enfocado (sin footer ni barra de estado)
just ext-pure-focus

# Con contador de herramientas
just ext-tool-counter

# Orquestador de equipos de agentes
just ext-agent-team

# Pipeline secuencial de agentes
just ext-agent-chain

# Declarar intención antes de trabajar
just ext-purpose-gate

# Meta-agente que construye agentes Pi
just ext-pi-pi

# Abrir todas las configuraciones en ventanas separadas
just all
```

### Abrir con extensiones personalizadas

```bash
just open minimal tool-counter theme-cycler
```

Esto abre una nueva terminal con Pi cargando las extensiones especificadas.

---

## 🧠 Equipos de agentes

Definidos en `agent/teams.yaml`, los equipos combinan múltiples agentes para flujos complejos:

| Equipo | Agentes | Propósito |
|--------|---------|-----------|
| `tdd` | starter → context-analyst → technical-architect → test-builder → polisher → tech-writter | Pipeline TDD completo |
| `full` | scout → planner → builder → reviewer → documenter → red-team | Ciclo completo de desarrollo |
| `plan-build` | planner → builder → reviewer | Planificar, construir, revisar |
| `info` | scout → documenter → reviewer | Investigación y documentación |
| `react` | interpreter-expert → material-ui-expert → project-scanner-expert → react-pattern-expert | Expertos en frontend React |
| `pi-pi` | ext-expert, theme-expert, skill-expert, config-expert, tui-expert, prompt-expert, agent-expert | Meta-agentes para construir Pi |
| `blt-plan` | outline → linear → architect-frontend → architect → spec-expert | Planificación de proyectos Boletia |

---

## 🔗 Cadenas de flujo de trabajo

Definidas en `agent/agent-chain.yaml`, orquestan pipelines multi-paso:

- **`plan-build-review`** — Planificar → Implementar → Revisar
- **`plan-build`** — Planificar → Implementar (sin revisión)
- **`scout-flow`** — Triple exploración: investigar, validar, verificar
- **`plan-review-plan`** — Planificar → Criticar → Refinar
- **`full-review`** — Scout → Planner → Builder → Reviewer

---

## 🎨 Extensiones TUI destacadas

| Extensión | Descripción |
|-----------|-------------|
| **agent-team** | Dashboard tipo grid con selección de equipo de agentes |
| **agent-chain** | Orquestador de pipelines secuenciales |
| **damage-control** | Auditoría de seguridad que revisa cambios antes de aplicarlos |
| **tilldone** | Disciplina de tareas: define una lista antes de codificar |
| **pi-pi** | Meta-agente que investiga el ecosistema Pi y genera extensiones |
| **subagent-widget** | `/sub <tarea>` con streaming de progreso en vivo |
| **cross-agent** | Carga comandos desde directorios `.claude/`, `.gemini/`, `.codex/` |
| **session-replay** | Línea de tiempo scrollable del historial de la sesión |
| **theme-cycler** | Cambia temas con Ctrl+X / Ctrl+Q |
| **system-select** | Selecciona la personalidad del agente con `/system` |

---

## 🛠️ Skills disponibles

Los skills son capacidades reutilizables que cualquier agente puede invocar:

- **`architect-backend/`** — Pipeline de 6 pasos: desde leer un issue en Linear hasta publicar en Outline
- **`architect-frontend/`** — Análisis de frontend, componentes, estados y patrones
- **`architecture-views/`** — Generación de vistas C4 y diagramas arquitectónicos
- **`go-master/`** — Experto en desarrollo Go
- **`react-master/`** — Experto en React y ecosistema
- **`pm-master/`** — Experto en gestión de proyectos técnicos

---

## 🧩 Stack tecnológico

- **Runtime:** [Bun](https://bun.sh/) + Node.js
- **Agente base:** [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent)
- **Extensiones:** TypeScript (API de extensiones de Pi)
- **Configuración:** YAML, JSON, Markdown
- **Automatización:** [just](https://github.com/casey/just) (task runner)
- **Herramientas integradas:** Linear API, Outline API, Playwright, Git

---

## 🎯 Filosofía

Este ecosistema está diseñado para:

1. **Composabilidad** — Combina extensiones, agentes y skills como bloques LEGO
2. **Especialización** — Cada agente tiene un rol preciso y un system prompt enfocado
3. **Orquestación** — Los equipos y cadenas permiten flujos complejos multi-agente
4. **Extensibilidad** — Fácil de añadir nuevas extensiones, agentes y skills
5. **Contexto persistente** — Las sesiones se guardan por proyecto para continuidad

---

## 📝 Licencia

Uso personal — configuración y extensiones privadas.
