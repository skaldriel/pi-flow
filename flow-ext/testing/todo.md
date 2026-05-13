# Pi Testing Extension — Project Tracker

> **Contexto:** Extensión de testing para Pi que ejecuta flujos de pruebas browser-driven. Cada flujo se define en YAML y cada paso es un archivo `.md` con instrucciones en prosa + assertions estructuradas. El agente principal de Pi ejecuta los pasos usando las browser tools del browser-agent.

---

## 🎯 Alcance del Proyecto

### V1 (Proof of Concept — actual)

Sistema funcional que permite:
- Definir flujos de test en `.agentic-tests/tests.yaml`
- Definir pasos individuales en `.agentic-tests/*.md` con assertions estructuradas
- Visualizar flujos como tarjetas numeradas en un grid paginado
- Ejecutar flujos con `Ctrl+1..9`
- Ver resultados paso a paso con checkmarks ✗/✓
- Compartir contexto de navegador entre pasos del mismo flujo
- Detener ejecución al primer fallo

### V2 (Futuro)

- Ejecución paralela de flujos vía subprocesos (`spawn`)
- Soporte para assertions visuales (`screenshot_matches`)
- Assertions de cookies, localStorage, status codes
- Reportes exportables (JSON, HTML)
- Integración CI/CD (modo headless, exit codes)
- Modo interactivo paso a paso con intervención humana

---

## 📋 Decisiones de Diseño

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| Ubicación de tests | `.agentic-tests/` en CWD | Portable, no depende de `.pi/` |
| Formato de flujos | `tests.yaml` con `name`, `description`, `viewport`, `steps` | YAML es legible y parseable sin dependencias |
| Formato de pasos | `.md` con frontmatter YAML (assertions) + body (prosa) | Híbrido: flexibilidad del LLM + determinismo de assertions |
| Viewport | `desktop` (1280×900) y `mobile` (390×844), default desktop, configurable en `settings.json` | Desktop-first, mobile cuando se necesite |
| Assertions V1 | 8 tipos: `url_equals`, `url_contains`, `text_visible`, `text_not_visible`, `element_exists`, `element_not_exists`, `element_count`, `value_equals` | Cubren 90% de casos: login, forms, navegación, scraping |
| Motor de ejecución V1 | Agente principal (no subprocesos) | Simple, debugeable, un solo navegador |
| Orquestación | `sendUserMessage()` + `agent_end` | Nativo de Pi, sin hacks |
| UI | 2 widgets: grid de tarjetas (`aboveEditor`) + resultados (`belowEditor`) | Visible siempre, no bloquea el chat |
| UI — overflow | Grid paginado (máx 9 tarjetas/página, `←`/`→` para navegar) | Escala a N flujos sin romper shortcuts `Ctrl+1..9` |
| Dependencia browser-agent | `import()` dinámico en `agent_end` | Si no está cargado, falla gracefully |
| Configuración avanzada | `settings.json` con key `viewportPresets` | Extensible sin modificar la extensión |
| Tema visual | `applyExtensionDefaults()` desde `themeMap.ts` | Consistente con otras extensiones del ecosistema |

---

## 📐 Requerimientos Funcionales

### RF1 — Descubrimiento de flujos
- [x] **RF1.1** — Leer `.agentic-tests/tests.yaml` desde el CWD al iniciar sesión
- [x] **RF1.2** — Si no existe `tests.yaml`, mostrar mensaje informativo en el widget
- [x] **RF1.3** — Parsear YAML sin dependencias externas (parser mínimo)

### RF2 — Visualización de flujos
- [x] **RF2.1** — Mostrar flujos como tarjetas numeradas en grid
- [x] **RF2.2** — Cada tarjeta muestra: nombre, #id, status (○ idle / ● running / ✓ passed / ✗ failed), viewport (🖥/📱), cantidad de tests, descripción
- [x] **RF2.3** — Grid se adapta al ancho de terminal: 3 cols (≥90), 2 cols (≥60), 1 col (<60)
- [x] **RF2.4** — Paginación: máx 9 tarjetas por página, `←`/`→` para navegar
- [x] **RF2.5** — Barra de navegación: `← Page 1/2 →`

### RF3 — Ejecución de flujos
- [x] **RF3.1** — `Ctrl+1..9` ejecuta el flujo en esa posición de la página actual
- [x] **RF3.2** — Comando `/test-flow <name>` ejecuta flujo por nombre
- [x] **RF3.3** — Comando `/test-flow` sin args muestra selector interactivo
- [x] **RF3.4** — No permitir ejecutar un flujo si ya hay uno corriendo
- [x] **RF3.5** — Compartir contexto de navegador entre pasos del mismo flujo
- [x] **RF3.6** — Detener flujo al primer fallo y mostrar razón

### RF4 — Pasos de test
- [x] **RF4.1** — Cada paso es un `.md` en `.agentic-tests/`
- [x] **RF4.2** — El body del `.md` contiene las instrucciones en prosa para el LLM
- [x] **RF4.3** — El frontmatter contiene assertions estructuradas en YAML
- [x] **RF4.4** — Si no hay frontmatter, el archivo entero se trata como body (sin assertions)

### RF5 — Assertions
- [x] **RF5.1** — `url_equals` — verifica URL exacta
- [x] **RF5.2** — `url_contains` — verifica que URL contiene string
- [x] **RF5.3** — `text_visible` — verifica texto visible en página
- [x] **RF5.4** — `text_not_visible` — verifica texto NO visible
- [x] **RF5.5** — `element_exists` — verifica existencia de elemento (18-strategy resolver)
- [x] **RF5.6** — `element_not_exists` — verifica NO existencia
- [x] **RF5.7** — `element_count` — verifica conteo de elementos (min, max, equals)
- [x] **RF5.8** — `value_equals` — verifica valor de input

### RF6 — Resultados
- [x] **RF6.1** — Widget de resultados debajo del grid con lista de pasos
- [x] **RF6.2** — Cada paso muestra: icono (✓/✗/◌/○), nombre, duración
- [x] **RF6.3** — Pasos fallidos muestran detalles del error
- [x] **RF6.4** — Status bar en footer con resumen (✓ N passed, ✗ M failed)
- [x] **RF6.5** — Notificación al finalizar flujo (pass/fail)

### RF7 — Viewport
- [x] **RF7.1** — `desktop` = 1280×900, `mobile` = 390×844
- [x] **RF7.2** — Default `desktop` si no se especifica
- [x] **RF7.3** — Configurable vía `settings.json` → `viewportPresets`

---

## 🔒 Requerimientos No Funcionales

- [x] **RNF1** — Sin dependencias npm externas (solo Pi + Playwright vía browser-agent)
- [x] **RNF2** — Cada línea de widget truncada a `width` de terminal (no crashes por overflow)
- [x] **RNF3** — Sin crashes si browser-agent no está cargado
- [ ] **RNF4** — Tiempo de respuesta de assertions < 3s
- [ ] **RNF5** — Funciona en terminales ≥ 80 columnas

---

## ✅ Tareas Completadas

### Fase 0 — Diseño
- [x] Definir formato de `tests.yaml` (flujos con viewport, descripción, steps)
- [x] Definir formato de `.md` de test (prosa + assertions en frontmatter)
- [x] Seleccionar 8 assertions para V1
- [x] Decidir arquitectura: agente principal vs subprocesos (V1 = agente principal)
- [x] Diseñar UI: grid paginado de tarjetas + panel de resultados
- [x] Definir shortcuts: `Ctrl+1..9` + `←`/`→`
- [x] Decidir viewport presets y mecanismo de configuración
- [x] Planificar V2 (paralelismo, assertions visuales, CI/CD)

### Fase 1 — Implementación core
- [x] Crear estructura de extensión `.pi/flow-ext/testing/`
- [x] `types.ts` — interfaces: `FlowDefinition`, `TestStep`, 8 `Assertion`, `StepResult`, `FlowState`
- [x] `assertion-engine.ts` — motor de assertions con 18-strategy locator resolver
- [x] `widgets.ts` — renderizado de card grid + results list con truncamiento defensivo
- [x] `index.ts` — extensión principal: hooks, shortcuts, flow runner
- [x] `package.json` — declaración de extensión

### Fase 2 — Hooks y eventos
- [x] `session_start` — carga flows, renderiza widgets, notifica al usuario
- [x] `before_agent_start` — inyecta TEST RUNNER MODE en system prompt
- [x] `session_shutdown` — limpia estado

### Fase 3 — Shortcuts y comandos
- [x] `Ctrl+1..9` — ejecutar flujo en posición
- [x] `←`/`→` — paginación del grid
- [x] `/test-flow <name>` — ejecutar flujo por nombre
- [x] `/test-flow` (sin args) — selector interactivo

### Fase 4 — Ejemplos
- [x] `.agentic-tests/tests.yaml` — 2 flujos de ejemplo (smoke-test + mobile-check)
- [x] `.agentic-tests/navigate-httpbin.md` — test de navegación básica
- [x] `.agentic-tests/check-form.md` — test de formulario
- [x] `.agentic-tests/follow-links.md` — test de conteo de links

### Fase 5 — Bug fixes
- [x] Fix: líneas de widget excedían ancho de terminal (overflow 140 > 84)
- [x] Fix: cambio de `turn_end` a `agent_end` para esperar completitud del agente
- [x] Fix: system prompt reforzado para evitar que agente responda a medio paso
- [x] Fix: regex de parser YAML acepta valores vacíos para assertions multi-línea

---

## 🔧 Tareas Pendientes

### Bugs y estabilización
- [ ] **BUG-01** — Verificar que `agent_end` realmente espera a que el agente complete TODOS los pasos (el agente podría responder después de `browser_launch` sin navegar)
- [ ] **BUG-02** — Si BUG-01 persiste, implementar **Opción B**: tool `complete_test_step` que el agente debe llamar para señalizar fin de paso
- [ ] **BUG-03** — Probar con terminales angostas (< 80 cols) para validar que no hay overflow
- [ ] **BUG-04** — Probar cuando browser-agent no está cargado (debe mostrar error gracefully)
- [ ] **BUG-05** — Probar con `tests.yaml` malformado (debe mostrar error claro)

### Features pendientes V1
- [ ] **FEAT-01** — Parser YAML robusto: manejar comillas, escaping, comentarios inline
- [ ] **FEAT-02** — Timeout por paso (si el agente se cuelga, avanzar o fallar)
- [ ] **FEAT-03** — Barra de progreso visual durante ejecución de paso
- [ ] **FEAT-04** — Vista expandida de resultados (overlay como `AgentExpandedOverlay` en agent-team)
- [ ] **FEAT-05** — Re-run de un flujo fallido con un solo shortcut
- [ ] **FEAT-06** — Las assertions que fallan deberían mostrar expected vs actual más claro
- [ ] **FEAT-07** — Configuración de `maxToolCalls` por flujo en `tests.yaml`
- [ ] **FEAT-08** — Permitir `Ctrl+C` para abortar un flujo en ejecución

### Refactors
- [ ] **REF-01** — Extraer parser YAML a su propio archivo (`yaml-parser.ts`)
- [ ] **REF-02** — Extraer lógica de ejecución de flujos a `flow-runner.ts`
- [ ] **REF-03** — Mover constantes de viewport a archivo de configuración
- [ ] **REF-04** — Tests unitarios para assertion-engine

### Documentación
- [ ] **DOC-01** — README con formato de tests.yaml y .md
- [ ] **DOC-02** — Guía de assertions con ejemplos
- [ ] **DOC-03** — Guía de configuración de viewports en settings.json

### V2 — Planeados
- [ ] **V2-01** — Ejecución paralela con subprocesos (`spawn("pi", ...)`)
- [ ] **V2-02** — Assertions visuales (`screenshot_matches`)
- [ ] **V2-03** — Assertions avanzadas: `cookie_exists`, `localStorage_has`, `status_code`, `evaluate`
- [ ] **V2-04** — Assertions de estado: `checked`, `disabled`, `enabled`, `selected`
- [ ] **V2-05** — Reportes exportables (JSON, HTML)
- [ ] **V2-06** — Modo CI/CD (headless, exit codes, output machine-readable)
- [ ] **V2-07** — Modo interactivo: pausa entre pasos, intervención humana

---

## 🏗️ Estructura del Proyecto

```
.pi/flow-ext/testing/
├── index.ts              ← Punto de entrada (674 loc)
├── types.ts              ← Interfaces (114 loc)
├── assertion-engine.ts   ← Motor de assertions (223 loc)
├── widgets.ts            ← Renderizado TUI (299 loc)
├── package.json          ← Declaración
└── todo.md               ← Este archivo

.agentic-tests/           ← Ejemplos (CWD del proyecto)
├── tests.yaml
├── navigate-httpbin.md
├── check-form.md
└── follow-links.md
```

---

## 🚀 Cómo ejecutar

```bash
pi -e .pi/flow-ext/browser-agent -e .pi/flow-ext/testing
```

---

*Última actualización: sesión actual. Próximo paso: resolver BUG-01 (validar `agent_end`).*
