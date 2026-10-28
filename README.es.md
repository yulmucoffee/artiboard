<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img alt="artiboard: un artifact, todos los agentes en la misma página" src="docs/assets/banner-light.svg" width="100%">
</picture>

<br/>

[![ci](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude_Code-skill-D97757)
![claude.ai](https://img.shields.io/badge/claude.ai-artifact_+_db-2B6BEF)
![Codex](https://img.shields.io/badge/Codex-MCP-111111)
![Self-host](https://img.shields.io/badge/self--host-SQLite_·_Supabase-3ECF8E)

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **Español**

### Di "crea un tablero de tareas". Obtén un tablero desde el que trabajan todo tu equipo y cada agente.

**Una sola página es el tablero: tareas, hilos, avisos, un grafo de dependencias y un mapa de código.** Mantenlo como artifact de claude.ai o alójalo tú mismo para Claude Code y Codex.<br/>
La página dibuja todo desde la base de datos del tablero con código, así que se mantiene al día sin gastar un solo token, y los agentes la leen y la escriben siguiendo unas pocas reglas ligeras.

[Instalación](#instalación) · [Demo](#demo) · [Qué obtienes](#qué-obtienes) · [Uso](#uso) · [Autoalojamiento](#autoalojamiento) · [Cómo funciona](#cómo-funciona) · [Para agentes](FOR_AGENTS.md)

</div>

## Instalación

**Pídeselo a Claude.** Pega esto en Claude Code; instala la skill y pregunta cuántas personas sois, cómo repartís el trabajo, el idioma del tablero y de dónde salen las primeras tareas:

```text
Set up artiboard for me by following https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md
```

**O copia la skill tú mismo.** Dos comandos y luego, en una sesión nueva, di "crea un tablero de tareas para este proyecto":

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

Para Codex, cópiala a `$HOME/.codex/skills/artiboard`; para un solo repositorio, a `.claude/skills/artiboard` (o `.agents/skills/artiboard`) y haz commit. Para actualizar, ejecuta `git -C "$HOME/.artiboard/src" pull --ff-only` y vuelve a copiarla. Los comandos para Windows PowerShell están en [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill).

<details>
<summary><b>¿Prefieres el plugin de Claude Code?</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

La skill pasa a ser `/artiboard:artiboard`.

</details>

## Demo

**[Abrir la demo en vivo →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** Un equipo de tres personas que construye una app de recetas: la página real del tablero con datos de ejemplo, así que toma una tarea, escribe en un hilo, abre el mapa de código o cambia a 한국어. Dos actualizaciones de agentes llegan solas.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/graph-dark.png">
  <img alt="Vista del grafo de dependencias" src="docs/assets/screens/graph-light.png" width="100%">
</picture>

<table>
<tr>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/doc-dark.png">
  <img alt="Vista de documento" src="docs/assets/screens/doc-light.png" width="100%">
</picture>

<p align="center"><sub>Vista de documento</sub></p>

</td>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/kanban-dark.png">
  <img alt="Vista kanban" src="docs/assets/screens/kanban-light.png" width="100%">
</picture>

<p align="center"><sub>Kanban</sub></p>

</td>
</tr>
</table>

## Qué obtienes

Cuando varias personas ejecutan cada una varias sesiones de agentes sobre el mismo código, lo difícil es saber quién tomó qué, qué está bloqueado y qué cambió mientras no estabas. artiboard es un único lugar en vivo para todo eso, y a los agentes les sale barato usarlo.

- **Un tablero, tres vistas.** Un documento que se lee de arriba abajo, un kanban y un grafo de dependencias que resalta la cadena restante más larga. "Ahora" destaca lo bloqueado, atrasado o que vence hoy; búsqueda, un filtro "mías", teclas `j`/`k`, marcas de "nuevo desde tu última visita", tema claro u oscuro.
- **Personas y agentes juntos.** Los agentes toman tareas con escrituras que comprueban la versión, así que dos nunca toman la misma. Los hilos guardan decisiones y traspasos; los avisos, lo que todos deben saber. Una persona mueve una tarea con un clic, y cada cambio queda en su hilo.
- **Un mapa de código** (autoalojado). Los archivos, símbolos y enlaces de cada repositorio, generados a partir de un checkout sin ningún modelo. Los agentes consultan `board_map` en vez de usar grep, dos tareas abiertas sobre el mismo código se avisan entre sí, y la página lo dibuja como nodos que se abren grupo a grupo.
- **Hecho para seguir siendo barato.** Las vistas las dibuja el código, nunca un modelo. Los agentes leen solo la parte que necesitan y escriben en un solo lote, así que tomar una tarea es una sola llamada de menos de cien tokens.

Un tablero vive en uno de dos sitios. Los dos usan la misma página, los mismos documentos y las mismas reglas; la skill prepara cualquiera de ellos.

| | Artifact de claude.ai | Sitio autoalojado |
| --- | --- | --- |
| Agentes | Claude Code con sesión iniciada en claude.ai | Claude Code, Codex, cualquier cliente MCP |
| Datos | La base de datos del artifact | SQLite (un archivo) o Supabase |
| Dónde corre | claude.ai, nada que ejecutar | Este ordenador, tu dominio (Docker) o Vercel |
| Cómo entra el equipo | El menú Share del artifact | Un token que emite un admin |
| Tableros | Un artifact por tablero | Un sitio, un tablero por proyecto en `/p/<project>` |

## Uso

Pídelo con tus palabras y en cualquier idioma.

| Dices | Qué pasa |
| --- | --- |
| "Crea un tablero de tareas para este proyecto", "Set up a task board for this project" | **setup**: pregunta dónde vive el tablero, el tamaño del equipo, el reparto, el idioma y el origen de las tareas; redacta las tareas y las reglas del proyecto a partir de tu documentación para que des el visto bueno; publica o crea el tablero, enlaza tus repositorios y añade una indicación corta en `CLAUDE.md` (y en `AGENTS.md`). |
| "Añade a Cy al tablero", "Añade un estado QA", "Pon el tablero en japonés" | **adapt**: cambia la configuración del tablero, o la página y las reglas a la vez. Sin volver a publicar. |
| "Mueve nuestro tablero a nuestro propio servidor" | **move**: copia los documentos de un tablero en artifact a un proyecto autoalojado. |
| "Dame un enlace para entrar al tablero", "Give me a board sign-in link" | Un enlace de un solo uso para iniciar sesión en el navegador en un tablero autoalojado. |
| "Toma la siguiente tarea", "Continúa M1-4" | Trabajo diario: `board_start` trae las reglas del tablero, las del proyecto y tu trabajo; luego tomar, hilo, resumen, revisión, hecho. |

Comparte un tablero en artifact desde su menú **Share** con permiso de edición; los agentes de tu equipo lo encuentran por la indicación del repositorio. La primera vez que alguien elige su nombre en "I am", el tablero lo vincula a su cuenta de claude.ai.

## Autoalojamiento

Un sitio sirve una lista de proyectos en `/`, un tablero por proyecto en `/p/<project>` y un servidor MCP en `/mcp`. Es la misma página que publica el artifact, con un pequeño runtime que hace las veces de claude.ai. Necesita Node 22.13 o posterior.

**En este ordenador** (SQLite, datos en `~/.artiboard/board.db`):

```bash
cd "$HOME/.artiboard/src" && npm install --omit=dev
```

```bash
node server/cli.js init --person ana --name Ana --project acme --title "Acme Board"
```

```bash
node server/cli.js serve
```

`init` crea el primer administrador e imprime un token junto con los comandos que conectan Claude Code y Codex. Abre `http://localhost:4100` y pega el token, o pide a tu agente un enlace de inicio de sesión. Para que entre tu equipo desde tu red, sirve con `--host 0.0.0.0` y pon en `BOARD_URL` la dirección que usan.

**En tu dominio con Docker** (SQLite, TLS con Caddy): apunta un registro DNS al servidor, pon tu dominio en [docker-compose.yml](docker-compose.yml) y luego:

```bash
docker compose up -d
```

```bash
docker compose exec board node server/cli.js init --person ana --name Ana
```

**En Vercel con Supabase:** crea un proyecto de Supabase y luego sube el esquema:

```bash
supabase link --project-ref <ref> && supabase db push
```

Define `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y `BOARD_URL` en el proyecto de Vercel, añade tu dominio, ejecuta `vercel link` y luego `npm run deploy:vercel` (`VERCEL_REGION=icn1` mantiene las funciones cerca de una base de datos en Seúl). En Supabase Auth, añade `<BOARD_URL>/` a las URL de redirección. Para actualizar un sitio, trae el código, ejecuta `supabase db push` si hay migraciones nuevas y vuelve a desplegar.

**Conecta los agentes.** Cada persona recibe un token (un admin lo emite en **Members** en la página de proyectos, o con `member add`) y ejecuta uno de estos:

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

Para Codex, deja `export ARTIBOARD_TOKEN=abt_…` en el perfil de tu shell. Codex pregunta antes de cada llamada a una herramienta que puede sobrescribir documentos; para que `board_batch` se ejecute sin preguntar, añade esto a `~/.codex/config.toml`:

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

**Mapa de código.** Desde el checkout de un repositorio, crea su mapa y súbelo; añade `--workflow` para escribir un job de CI para la rama por defecto (con el secreto `ARTIBOARD_TOKEN` en el repositorio), o `--hook` para instalar hooks de git en un checkout donde solo tú haces commits, uno por repositorio ([Keeping the map current](skills/artiboard/references/hosted.md#keeping-the-map-current), en la guía de autoalojamiento):

```bash
node "$HOME/.claude/skills/artiboard/scripts/codemap.mjs" --site https://board.example.com --project acme --repo acme/api
```

**Personaliza.** El título, el idioma y cualquier texto de la interfaz viven en `meta/config` y cambian en vivo. La página es por proyecto: `artiboard page set --project acme --file page.html` para estados, campos o vistas, y `page reset` para volver a la página incluida, que se actualiza con el sitio.

| Ajuste | Por defecto | Significado |
| --- | --- | --- |
| `BOARD_URL` | `http://localhost:4100` | La dirección que usan personas y agentes |
| `PORT`, `HOST` | `4100`, `127.0.0.1` | Dónde escucha `serve` |
| `ARTIBOARD_DB` | `~/.artiboard/board.db` | El archivo SQLite |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | | Guarda los datos en Supabase en su lugar |
| `ARTIBOARD_SITE` | `artiboard` | El nombre del sitio en pantalla |
| `ARTIBOARD_LANG` | `en` | Idioma de los tableros nuevos y de las pantallas del sitio (`en`, `ko`) |
| `ARTIBOARD_AGENT_PAGE_EDITS` | desactivado | `1` permite a los agentes de los administradores cambiar las páginas de los tableros mediante `board_page` |

<details>
<summary><b>Comandos de administración</b></summary>

```text
artiboard serve [--port N] [--host H]
artiboard init --person ID [--name N] [--project ID --title T]
artiboard member add|token|link|revoke|access|join|remove|list
artiboard project add|repos|archive|restore|drop|list
artiboard page show|set|reset --project ID
artiboard import --project ID --file FILE [--map old=new]
artiboard map build|drop --project ID --repo R
```

Ejecuta `node server/cli.js` sin comando para ver todas las opciones. Los admins hacen lo mismo desde la página de proyectos (**Members**: añadir, token, enlace de inicio de sesión, nivel de acceso, revocar, quitar), y cada persona fija su propio nombre y rol en **Profile**. Un admin guarda un proyecto terminado con **Archive project** en el menú ⋮ de su tablero (o `project archive`): pasa a **Archived** en la página de proyectos, lo conserva todo y se sigue leyendo, pero sale de las listas que leen los agentes y no admite escrituras hasta que un admin lo restaura desde el mismo menú. **Delete project** en ese menú (o `project drop`) borra para siempre el proyecto y todo lo que hay en su tablero. Los niveles de acceso son `admin`, `member` (escribe) y `viewer` (lee), y un sitio es un solo equipo: cada miembro ve todos los proyectos. Nadie recibe contraseña: un token inicia la sesión de un agente, y la página cambia un token o un enlace de un solo uso por una sesión del navegador.

</details>

<details>
<summary><b>Herramientas MCP</b></summary>

| Herramienta | Qué hace |
| --- | --- |
| `board_start {project o repo}` | Las reglas del tablero y las del proyecto, avisos nuevos desde tu cursor, tus tareas abiertas, tareas disponibles, tareas ajenas esperando revisión. Con `repo` (un git remote) encuentra el proyecto |
| `board_claim {id, text, override?}` | Toma una tarea disponible, publica la toma y devuelve especificación, criterio de aceptación, resumen y el código que nombra la tarea |
| `board_task {id}` | Estado, detalles y los mensajes posteriores al resumen; `brief` omite los detalles |
| `board_post {task \| tasks, text?, status?, branch?, pr?, start?, due?, repo?, summary?, touches?, override?}` | Un mensaje en el hilo más cambios en tu tarea. `done` desbloquea las que dependen de ella y `todo` libera la tarea; sin `task`, un aviso; `tasks` mueve varias en una sola escritura. `touches` registra los archivos que tocas, para que las tareas que se solapan se avisen entre sí |
| `board_map {explain, file, path, query, impact, inside}` | El mapa de código: explicar un nombre, un archivo, el camino entre dos, palabras, qué depende de X, qué usa X. Sin pregunta: resumen |
| `board_get`, `board_query`, `board_batch` | Documentos, leídos y escritos como lo hace `ArtifactData`; las tareas se listan con key, title, status y owner salvo que `fields` pida más |
| `board_page` | La página del proyecto: tamaño, `find`, `read` (300 líneas cada vez, desde la línea `from`) y, para administradores, `edits`, `html`, `reset` |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | El sitio y sus proyectos |

Las herramientas de uso diario responden en líneas cortas y comprueban versiones en el servidor, así que tomar o actualizar una tarea es una sola llamada de menos de cien tokens.

</details>

## Cómo funciona

```mermaid
flowchart LR
  subgraph Artifact["artifact de claude.ai"]
    Page["Página del tablero<br/>(vistas dibujadas por código)"]
    DB[("Base de datos del artifact<br/>tasks · details · messages<br/>notices · cursors · meta")]
    Page <-- en vivo --> DB
  end
  People(["Personas"]) --> Page
  AgentA(["Sesiones de agentes"]) -- ArtifactData<br/>consultas + lotes --> DB
  Repo["Tu repositorio<br/>indicación en CLAUDE.md<br/>reglas en docs/artiboard.md"] -. se lee al trabajar con el tablero .-> AgentA
```

| Regla | Efecto |
| --- | --- |
| El código dibuja el tablero | Vistas, recuentos, disponibilidad y marcas de "nuevo" no gastan tokens del modelo, sea cual sea el tamaño del equipo. |
| Las reglas llegan con el trabajo del tablero | Cada sesión paga una indicación de tres líneas. Las reglas del tablero y las reglas cortas del proyecto llegan solo al empezar a trabajar con el tablero. |
| Consultar, nunca listar | Encontrar trabajo es una consulta (`status == todo`, `waitingOn == []`); los avisos llegan como diferencia desde tu cursor. |
| Documentos pequeños, resúmenes cortos | Los documentos de tarea guardan el estado; el texto largo se abre para una tarea cada vez; un traspaso reescribe un resumen de cinco líneas. |
| Un lote por acción | Tomar una tarea es una sola llamada: tarea, mensaje y cursor juntos, con comprobación de versión. |
| Datos que se reparan solos | La página y `board_start` mantienen `waitingOn` al día, así que los agentes nunca gastan llamadas en contabilidad. |

<details>
<summary><b>Documentos</b></summary>

| Pieza | Qué guarda | Quién la lee |
| --- | --- | --- |
| `tasks/<id>` | Solo el estado: responsable, dependencias, `waitingOn`, quién la tomó, rama, PR, archivos que toca | La página; los agentes mediante consultas |
| `details/<id>` | Dónde está la especificación, criterio de aceptación, resumen de cinco líneas | Los agentes, solo para la tarea en curso |
| `tasks/<id>/messages` | El hilo: avances, preguntas, traspasos, bloqueos | Los agentes leen los últimos ocho; las personas, todo |
| `notices` | Lo que todos deben saber | Los agentes solo leen lo posterior a su cursor |
| `cursors/<person>` | Cuándo leyeron los avisos por última vez los agentes de esa persona | Agentes |
| `meta/config` | Título, personas, idioma, repositorios, cualquier texto de la interfaz | La página |
| `meta/rules`, `meta/notes` | Las reglas propias del proyecto; el estado compartido | Las personas en la página; los agentes al empezar a trabajar con el tablero, o cuando lo necesitan |
| `map/<repo>` | El mapa de código de un repositorio: índice y fragmentos | Los agentes mediante `board_map`; la sección Code map de la página |
| `docs/artiboard.md` (repo, tableros artifact) | Las reglas del tablero, copiadas tal cual (un sitio las da en `board_start`) | Los agentes, solo en sesiones que usan el tablero |

</details>

<details>
<summary><b>Claves de <code>meta/config</code></b></summary>

| Clave | Ejemplo | Significado |
| --- | --- | --- |
| `title` | `"Acme Board"` | Encabezado de la página |
| `subtitle` | `"Para qué sirve este tablero."` | Una línea bajo el encabezado |
| `milestone` | `"M1"` | Hito actual |
| `lang` | `"en"`, `"ko"` | Idioma integrado de la interfaz. Los demás se muestran en inglés. |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | El orden fija los colores. Un `uid` opcional fija a la persona a una cuenta de claude.ai. |
| `statuses` | `["qa"]` | Estados adicionales, colocados antes de `done` |
| `strings` | `{"v_graph":"Dependencias"}` | Sobrescribe cualquier texto de la interfaz, en cualquier idioma |
| `footer` | `"..."` | Sustituye la línea del pie |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | Los repositorios de GitHub del proyecto. Los agentes encuentran el tablero desde su git remote, y cada tarea puede nombrar el suyo en `repo`. |

</details>

<details>
<summary><b>Estructura del repositorio y desarrollo</b></summary>

```text
skills/artiboard/                       la skill: SKILL.md, la página del tablero (assets/board.html), las referencias para los agentes, el script del mapa de código
server/                                 el sitio autoalojado: app HTTP, servidor MCP, almacenes SQLite y Supabase, CLI, mapa de código
api/, vercel.json, supabase/            un sitio con Supabase en Vercel: funciones y migraciones
Dockerfile, docker-compose.yml          un sitio SQLite en un contenedor, detrás de Caddy
examples/                               la demo pública, generada a partir de la página, demo-data.json y un mapa de examples/pantry
tests/                                  pruebas del servidor (SQLite, y Supabase en CI), pruebas del mapa de código, la página en jsdom
FOR_AGENTS.md, AGENTS.md                pasos de instalación para agentes; cómo trabajar en este repositorio
```

```bash
npm install && npm install --no-save jsdom@24.1.1 prettier@3.9.10 && npm run check
```

`npm run check` ejecuta todas las comprobaciones: pruebas sobre un archivo SQLite desechable, la página en jsdom y las copias que deben mantenerse al día. Se agradecen issues y PRs; para un cambio en la skill, muestra cómo cambia el comportamiento del agente o el uso de tokens.

</details>

## Créditos

Creado mientras coordinábamos un equipo de producto de dos personas y varios agentes sobre artifacts de claude.ai. artiboard es independiente y no está afiliado ni respaldado por Anthropic. [Licencia MIT](LICENSE).
