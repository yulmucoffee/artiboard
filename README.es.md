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

**Una sola página se convierte en el tablero: tareas, hilos, avisos y un grafo de dependencias.** Mantenlo como artifact de claude.ai o alójalo tú mismo para Claude Code y Codex.<br/>
La página dibuja todo desde la base de datos del tablero con código, así que se mantiene al día sin gastar un solo token.<br/>
Los agentes siguen unas pocas reglas ligeras que viven en tu repositorio: consultar en vez de listar, un lote por acción, resúmenes en vez de hilos largos.

[Demo](#demo) · [Inicio rápido](#inicio-rápido) · [Uso](#uso) · [Autoalojamiento](#autoalojamiento) · [Cómo funciona](#cómo-funciona) · [Diseño de tokens](#diseño-de-tokens) · [Para agentes](FOR_AGENTS.md)

</div>

> [!TIP]
> **Deja que Claude lo instale.** Pega esto en Claude Code:
>
> ```text
> Instala artiboard siguiendo https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md
> ```
>
> Claude instala la skill y luego pregunta cuántas personas (1, 2, 3 o cualquier número), cómo repartís el trabajo, el idioma del tablero y de dónde salen las primeras tareas.

## Demo

**[Abrir la demo en vivo →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** Un equipo ficticio de tres personas que construye una app de recetas, con 14 tareas. Ejecuta la página real del tablero con datos de ejemplo dentro de la página, así que pruébalo sin miedo: toma una tarea, escribe en un hilo, busca, pulsa `j`/`k`. A los pocos segundos llegan solas dos actualizaciones de agentes. El botón English / 한국어 de arriba cambia toda la demo, datos de ejemplo incluidos, a coreano. En el kanban puedes plegar una columna, verla en dos columnas de tarjetas o archivar el trabajo terminado.

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

## Por qué artiboard

Cuando dos personas ejecutan varias sesiones de Claude cada una sobre el mismo código, lo difícil no es el código. Es saber quién tomó qué, qué está bloqueado y qué cambió mientras no estabas. El historial del chat no viaja entre sesiones, y pegar todo el estado en cada prompt sale caro muy rápido.

artiboard da al equipo un único lugar compartido y en vivo para ese estado, y da a los agentes una forma barata y estricta de usarlo.

<table>
<tr>
<td width="33%" valign="top">

### 🗂️ Un tablero, tres vistas

Una vista de documento que se lee de arriba abajo, un kanban y un grafo de dependencias que resalta la cadena restante más larga. La actividad reciente muestra el último mensaje de cada tarea que se movió, y "Ahora" destaca lo bloqueado, atrasado o que vence hoy. Búsqueda, columnas ordenables, un filtro "mías", teclas `j`/`k` y marcas de "nuevo desde tu última visita". Tema claro, oscuro o automático. El kanban ocupa toda la ventana como en Notion: las columnas se pliegan o muestran dos columnas de tarjetas, y lo terminado se archiva de una vez.

</td>
<td width="33%" valign="top">

### 🤝 Personas y agentes juntos

Cada persona tiene un color. Los agentes toman tareas con escrituras que comprueban la versión, así que dos agentes nunca toman la misma. Los hilos guardan decisiones, preguntas y traspasos. Los avisos llevan lo que todos deben saber. Quien revisa cierra la tarea en revisión, y un agente toma la tarea de otra persona solo cuando su persona se lo pide. Las personas también mueven tareas con un clic, y cada cambio queda en el hilo.

</td>
<td width="33%" valign="top">

### 🪶 Hecho para seguir siendo barato

Las vistas las dibuja el código, nunca un modelo. Los agentes leen solo la parte que necesitan y escriben en un solo lote. Cuanto más dura el proyecto, más se nota.

</td>
</tr>
</table>

## Inicio rápido

Un tablero vive en uno de dos sitios. Los dos usan la misma página, los mismos documentos y las mismas reglas, y la skill prepara cualquiera de ellos.

| | Artifact de claude.ai | Sitio autoalojado |
| --- | --- | --- |
| Agentes | Claude Code con sesión iniciada en claude.ai (`Artifact`, `ArtifactData`) | Claude Code, Codex, cualquier cliente MCP (servidor MCP `artiboard`) |
| Datos | La base de datos del artifact | SQLite (un archivo) o Supabase |
| Dónde corre | claude.ai, nada que ejecutar | Este ordenador, tu dominio (Docker) o Vercel |
| Cómo entra el equipo | El menú Share del artifact | Un token que un admin emite en la página de proyectos o con `artiboard member add` |
| Tableros | Un artifact por tablero | Un sitio, un tablero por proyecto en `/p/<project>` |

Para un tablero autoalojado, levanta primero el sitio: [Autoalojamiento](#autoalojamiento).

**Opción A: que lo haga Claude.** Usa el texto del recuadro de arriba. Claude sigue [FOR_AGENTS.md](FOR_AGENTS.md).

**Opción B: solo para mí, en todos los proyectos**

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

Abre una sesión nueva en tu proyecto y di "crea un tablero de tareas para este proyecto".

**Opción C: para el repositorio de mi equipo** (ejecútalo en la raíz del repositorio y haz commit)

```bash
mkdir -p .claude/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .claude/skills/artiboard/
```

**Opción D: Codex.** La misma skill funciona en Codex. Cópiala a `~/.codex/skills/artiboard` para todos los proyectos, o a `.agents/skills/artiboard` dentro de un repositorio:

```bash
mkdir -p "$HOME/.codex/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.codex/skills/artiboard/"
```

Codex trabaja con tableros autoalojados (no tiene artifacts de claude.ai).

Para actualizar, ejecuta `git -C "$HOME/.artiboard/src" pull --ff-only` y luego el mismo comando de copia otra vez. En Windows PowerShell, usa los comandos de [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill).

<details>
<summary><b>¿Prefieres el plugin de Claude Code?</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

La skill pasa a ser `/artiboard:artiboard`.

</details>

## Uso

Pídelo con tus palabras y en cualquier idioma.

| Dices | Qué pasa |
| --- | --- |
| "Crea un tablero de tareas para este proyecto" | **setup**: pregunta dónde vive el tablero, el tamaño del equipo, el reparto, el idioma y el origen de las tareas. Redacta las tareas y las reglas del proyecto a partir de tu documentación y te las muestra para que digas sí. Publica o crea el tablero, enlaza tus repositorios de GitHub, lo llena y añade una indicación corta en `CLAUDE.md` (y en `AGENTS.md` para Codex). |
| "Añade a Cy al tablero", "Pon el tablero en inglés" | **adapt**: actualiza la configuración del tablero. Sin volver a publicar. |
| "Añade un estado QA", "Muestra estimaciones en las tarjetas" | **adapt**: modifica la página y las reglas a la vez. En un tablero autoalojado, mediante ediciones con `board_page`. |
| "Mueve nuestro tablero a nuestro propio servidor" | **move**: copia los documentos de un tablero en artifact a un proyecto autoalojado. |
| "Dame un enlace para entrar al tablero" | Un enlace de un solo uso para iniciar sesión en el navegador en un tablero autoalojado. |
| "Toma la siguiente tarea", "Continúa M1-4" | Trabajo diario. El agente empieza con `board_start` (en un tablero artifact, `docs/artiboard.md`), que le da las reglas del tablero, las del proyecto y su trabajo: tomar, hilo, resumen, revisión, hecho. |

Después, comparte el tablero con tu equipo desde el menú **Share** del artifact con permiso de edición. Sus agentes encuentran el tablero por la indicación al hacer pull del repositorio. La página sabe quién la está viendo: la primera vez que alguien elige su nombre en "I am", el tablero lo vincula a su cuenta de claude.ai y lo elige por ella desde entonces. Avisa cuando alguien publica con un nombre vinculado a otra cuenta, y quien solo puede ver no recibe los botones de tomar, publicar ni editar.

## Autoalojamiento

Un sitio autoalojado sirve una lista de proyectos en `/`, un tablero por proyecto en `/p/<project>` y un servidor MCP en `/mcp`. La página del tablero es el mismo `board.html` que publica el artifact, con un pequeño runtime (`server/public/shim.js`) que hace las veces de claude.ai: inicia la sesión de las personas, lee y escribe los datos del sitio y envía cada cambio a las páginas abiertas. Necesita Node 22.13 o posterior. La lista de proyectos empieza con quién trabaja en qué, tablero por tablero.

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

**En Vercel con Supabase:** crea un proyecto de Supabase y luego sube el esquema y configura el entorno del sitio:

```bash
supabase link --project-ref <ref> && supabase db push
```

Define `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y `BOARD_URL` en el proyecto de Vercel, añade tu dominio, ejecuta `vercel link` y luego `npm run deploy:vercel` (`VERCEL_REGION=icn1` mantiene las funciones cerca de una base de datos en Seúl). En Supabase Auth, añade `<BOARD_URL>/` a las URL de redirección. Los comandos de administración se ejecutan desde cualquier lugar con esas variables en un archivo: `node server/cli.js --env site.env member list`. El mismo servidor también funciona con Supabase desde cualquier host: define las tres variables `SUPABASE_*` y ejecuta `serve`. Para actualizar un sitio, trae el código, ejecuta `supabase db push` si hay migraciones nuevas y vuelve a desplegar.

**Conecta los agentes.** Cada persona recibe un token (un admin lo emite en **Miembros** en la página de proyectos, o con `member add` o `member token`) y ejecuta:

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

Para Codex, deja `export ARTIBOARD_TOKEN=abt_…` en el perfil de tu shell. Codex pregunta antes de cada llamada a una herramienta que puede sobrescribir documentos (`board_batch`, `board_page`); para que `board_batch` se ejecute sin preguntar, añade esto a `~/.codex/config.toml`:

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

Luego pide al agente "prepara el tablero para este repositorio".

**Personaliza** exactamente como en claude.ai. El título, el idioma y cualquier texto de la interfaz viven en `meta/config` y cambian en vivo; quién está en un tablero lo deciden los administradores (`member join`, `member remove`). La página en sí es por proyecto: un administrador ejecuta `artiboard page set --project acme --file page.html` (estados, campos, vistas), y `page reset` vuelve a la página incluida, que se actualiza con el sitio. El código de la página se ejecuta para cada miembro, así que los agentes solo leen las páginas (`board_page` con `find`) salvo que el sitio defina `ARTIBOARD_AGENT_PAGE_EDITS=1`; entonces el agente de un administrador puede cambiar una página con ediciones pequeñas y exactas.

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
artiboard project add|repos|drop|list
artiboard page show|set|reset --project ID
artiboard import --project ID --file FILE [--map old=new]
```

Ejecuta `node server/cli.js` sin comando para ver todas las opciones. Los admins hacen lo mismo desde el sitio: la página de proyectos tiene un panel **Miembros** (añadir, nuevo token, enlace de acceso, nivel, revocar, quitar), y cada persona fija su propio nombre y rol en **Perfil**, que se muestra en todos los tableros donde está. Los niveles de acceso son `admin`, `member` (escribe) y `viewer` (lee), y valen para todo el sitio: cada miembro ve todos los proyectos. Los miembros nunca reciben contraseña: un token inicia la sesión de un agente, y la página cambia un token o un enlace de un solo uso por una sesión del navegador. `member revoke` también cierra esas sesiones. Solo los administradores cambian quién es quién (`meta/config.people`, `people/`), y los mensajes y avisos siempre llevan el nombre de quien los escribe.

</details>

<details>
<summary><b>Herramientas MCP</b></summary>

| Herramienta | Qué hace |
| --- | --- |
| `board_start {project o repo}` | Las reglas del tablero y del proyecto, avisos nuevos desde tu cursor (y lo avanza), tus tareas abiertas, tareas disponibles. Con `repo` (un git remote) encuentra el proyecto y muestra el trabajo de ese repositorio |
| `board_claim {id, text, override?}` | Toma una tarea disponible, publica la toma y devuelve especificación, criterio de aceptación y resumen. `override` toma la tarea de otra persona cuando tu persona lo pide |
| `board_task {id}` | Estado, detalles y los mensajes posteriores al resumen |
| `board_post {task, text?, status?, branch?, pr?, start?, due?, repo?, summary?, override?}` | Un mensaje en el hilo más cambios en tu tarea; cualquiera puede mover el `due` de una tarea. `done` registra `doneAt` y desbloquea las que dependen de ella; `todo` libera la tarea para cualquiera. Sin `task`: un aviso. Una tarea en revisión queda abierta a quien la revisa (`done` o de vuelta a `doing`); `override` cambia la tarea de otra persona cuando tu persona lo pide, y el hilo nombra a quien la tenía |
| `board_get`, `board_query`, `board_batch` | Documentos, leídos y escritos como lo hace `ArtifactData` |
| `board_page` | La página del proyecto: tamaño, `find`, `read` y, para administradores, `edits`, `html`, `reset` |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | El sitio; cada proyecto muestra sus repositorios de GitHub |

Las herramientas de uso diario responden en líneas cortas, comprueban versiones y ponen la hora en el servidor, así que tomar o actualizar una tarea es una sola llamada de menos de cien tokens.

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
  Repo["Tu repositorio<br/>indicación en CLAUDE.md<br/>reglas en docs/artiboard.md"] -. solo al trabajar con el tablero .-> AgentA
```

| Pieza | Qué guarda | Quién la lee |
| --- | --- | --- |
| `tasks/<id>` | Solo el estado: responsable, dependencias, `waitingOn`, quién la tomó, rama, PR, `archivedAt` | La página; los agentes mediante consultas |
| `details/<id>` | Dónde está la especificación, criterio de aceptación, resumen de cinco líneas | Los agentes, solo para la tarea en curso |
| `tasks/<id>/messages` | El hilo: avances, preguntas, traspasos, bloqueos | Los agentes leen los últimos ocho; las personas, todo |
| `notices` | Lo que todos deben saber | Los agentes solo leen lo posterior a su cursor |
| `cursors/<persona>` | Cuándo leyeron los avisos por última vez los agentes de esa persona | Agentes |
| `meta/config` | Título, personas, idioma, repositorios de GitHub, textos de la interfaz | La página |
| `meta/rules` | Las reglas propias del proyecto: quién lleva qué, dónde están las especificaciones, ramas, qué anunciar | Las personas en la página; los agentes al empezar a trabajar con el tablero |
| `meta/notes` | Estado compartido: calendario, dónde está cada cosa, preguntas abiertas | Las personas en la página; los agentes solo cuando lo necesitan |
| `people/<person>` | Qué cuenta de claude.ai eligió primero a esa persona | La página |
| `docs/artiboard.md` (repo, tableros artifact) | Las reglas del tablero, copiadas tal cual (un sitio autoalojado las da en `board_start`) | Los agentes, solo en sesiones que usan el tablero |

## Diseño de tokens

| Regla | Efecto |
| --- | --- |
| El código dibuja el tablero | Vistas, gráficos, recuentos, disponibilidad y marcas de "nuevo" no gastan tokens del modelo, sea cual sea el tamaño del equipo. |
| Las reglas llegan con el trabajo del tablero | Cada sesión paga una indicación de tres líneas. Las reglas del tablero, iguales en todos, y las reglas cortas del proyecto llegan solo al empezar a trabajar con el tablero; las notas de estado se leen solo cuando hacen falta. Las reglas del tablero vienen con artiboard, así que ningún proyecto guarda ni edita una copia. |
| Consultar, nunca listar | Encontrar trabajo es una consulta (`status == todo`, `waitingOn == []`). Los avisos llegan como diferencia desde tu cursor. |
| Documentos pequeños | Las tareas guardan el estado. El texto largo se abre para una tarea cada vez. |
| Resúmenes en vez de hilos | Cada traspaso reescribe un resumen de cinco líneas, así que quien sigue se salta los mensajes viejos. |
| Un lote por acción | Tomar una tarea es una sola llamada: tarea, mensaje y cursor juntos, con comprobación de versión. |
| Datos que se reparan solos | Mientras alguien tiene el tablero abierto, la página corrige `waitingOn`, y `board_start` comprueba la disponibilidad contra las propias tareas de las que depende y la repara de paso, así que los agentes no gastan llamadas en contabilidad. |
| La misma lista para todos | La lista de herramientas y las instrucciones del servidor son idénticas para cada miembro, así que la caché de prompts las conserva; los límites de tamaño son pruebas. |

## Referencia

<details>
<summary><b>Claves de <code>meta/config</code></b></summary>

| Clave | Ejemplo | Significado |
| --- | --- | --- |
| `title` | `"Acme Board"` | Encabezado de la página |
| `subtitle` | `"Para qué sirve este tablero."` | Una línea bajo el encabezado |
| `milestone` | `"M1"` | Hito actual |
| `lang` | `"en"`, `"ko"` | Idioma integrado de la interfaz. Los demás se muestran en inglés; el español se cubre con `strings`. |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | El orden fija los colores. Seis colores y luego se repiten. Un `uid` opcional fija a la persona a una cuenta de claude.ai y prevalece sobre `people/<id>`. |
| `strings` | `{"v_graph":"Dependencias"}` | Sobrescribe cualquier texto de la interfaz, en cualquier idioma |
| `footer` | `"..."` | Sustituye la línea del pie |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | Los repositorios de GitHub del proyecto. Los agentes encuentran el tablero desde su git remote, y cada tarea puede nombrar el suyo en `repo`. |

</details>

<details>
<summary><b>Qué puede cambiar la skill en cada proyecto</b></summary>

Libremente: título, personas, roles, idioma, textos, nombres de funciones, esquema de claves, redacción de mensajes, temas de avisos. Editando la página: estados, campos visibles adicionales, vistas nuevas. Se mantiene siempre: tareas ligeras más details, `waitingOn` y la consulta de disponibles, cursores, un lote por acción con `if_version`, formatos de id, reglas del tablero que vienen con artiboard (los proyectos solo añaden `meta/rules`), el texto del tablero tratado como datos.

</details>

<details>
<summary><b>Estructura del repositorio</b></summary>

```text
skills/artiboard/SKILL.md               la skill: instalación, adaptación, actualización, reglas de tokens
skills/artiboard/assets/board.html      la página del tablero (dibuja desde la base de datos del artifact)
skills/artiboard/references/          reglas del tablero para tableros artifact, cómo escribir las reglas del proyecto y la guía de autoalojamiento para agentes
server/                                 el sitio autoalojado: app HTTP, servidor MCP, almacenes SQLite y Supabase, CLI, runtime de la página
api/, vercel.json                       funciones de Vercel para un sitio con Supabase
supabase/                               el esquema de Supabase (migraciones) y la configuración local
Dockerfile, docker-compose.yml          un sitio SQLite en un contenedor, detrás de Caddy en tu dominio
examples/                               genera la demo pública a partir de board.html y demo-data.json: build-demo.cjs, demo-data.json, demo.html
FOR_AGENTS.md                           instalación paso a paso para agentes de IA
.claude-plugin/                         manifiestos del plugin de Claude Code
tests/smoke.cjs                         prueba de humo de la página con jsdom
tests/server.test.js                    pruebas de extremo a extremo de un sitio alojado (SQLite, y Supabase si está configurado)
docs/assets/                            banners
```

</details>

<details>
<summary><b>Desarrollo</b></summary>

```bash
npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
```

```bash
npm install && npm test
```

`npm test` ejecuta el sitio alojado sobre un archivo SQLite desechable. Con un Supabase local (`supabase start`), añade `AB_SUPABASE=1` y sus `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` para ejecutar las mismas pruebas allí.

Regenera la demo después de cambiar la página:

```bash
node examples/build-demo.cjs
```

Se agradecen issues y PRs. Para un cambio en la skill, muestra cómo cambia el comportamiento del agente o el uso de tokens, idealmente con un antes y un después en un tablero real.

</details>

## Créditos

Creado mientras coordinábamos un equipo de producto de dos personas y varios agentes sobre artifacts de claude.ai. artiboard es independiente y no está afiliado ni respaldado por Anthropic. [Licencia MIT](LICENSE).
