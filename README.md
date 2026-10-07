# DC CUP 3RA EDICIÓN · CONTROL MAESTRO V3

Sistema full-stack para administrar un torneo de Free Fire desde Visual Studio Code.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Base de datos: SQLite mediante `sql.js`
- Login: JWT en cookie HttpOnly + bcrypt
- Actualización pública: Server-Sent Events (SSE) + respaldo de actualización cada 30 s
- Archivos: logos, fotos, portada LIVE y música en `uploads/`

## Novedades V3

### 1. Constructor profesional de fases

El jefe del torneo puede decidir **cuántas fases habrá (1 a 8)** y configurar cada una:

- nombre de la fase;
- cantidad de participantes;
- cantidad de grupos;
- equipos por grupo calculados automáticamente;
- clasificación por grupo o clasificación general;
- cuántos clasifican por grupo / en total;
- número de jornadas;
- modalidad de salas: grupos separados, cruces, todos juntos o personalizado;
- cruces como `AxB,CxA,BxC`;
- salas por cruce/grupo y jornada;
- descripción pública.

Reglas DC CUP incluidas:

- fases previas por grupos: **12 equipos por grupo**;
- Semifinal: **18 equipos, 3 grupos de 6**;
- Gran Final: **12 equipos, 1 grupo**;
- Booyah de Oro: disponible **solo en la última fase**.

Hay un preset listo: `36 equipos → 18 semifinalistas → 12 finalistas`.

### 2. Resultados dinámicos

El selector de resultados ya no está fijo a Semifinal/Final. Se reconstruye con todas las fases, jornadas y salas que configure el administrador.

### 3. Moderadores y casters

En Producción puedes:

- agregar o quitar todos los moderadores y casters que quieras;
- colocar nombre;
- colocar Instagram opcional;
- subir foto opcional;
- configurar título de transmisión;
- link de YouTube/Twitch/otra plataforma HTTPS;
- activar `EN VIVO AHORA`;
- subir portada de la transmisión;
- subir música MP3/OGG.

### 4. Admins de puntajes

El administrador principal puede crear cuentas especiales para moderadores:

- nombre;
- Instagram;
- usuario;
- contraseña;
- foto;
- activar/desactivar acceso;
- decidir si aparece públicamente como moderador.

Estas cuentas tienen rol **ADMIN DE PUNTAJES**. Solo pueden registrar resultados y cambiar su propia contraseña. No pueden cambiar el formato, usuarios, equipos ni configuración maestra.

### 5. Galería de logos para el jefe

En `EQUIPOS Y LOGOS` aparece una galería profesional con:

- todos los equipos;
- grupo y slot;
- logo;
- estado de cuenta;
- botón para descargar el PNG del logo;
- edición de nombre/iniciales;
- creación/restablecimiento de usuario y contraseña del equipo.

### 6. Actualizaciones públicas en tiempo real

Cuando el administrador o un moderador autorizado guarda cambios, el backend avisa a los navegadores conectados mediante SSE y la página pública vuelve a cargar los datos automáticamente.

Esto significa que, **cuando publiques frontend y backend como una sola aplicación central**, todos los visitantes verán las actualizaciones del torneo sin tener que usar la misma computadora del administrador.

---

## Inicio en Windows / Visual Studio Code

Abre la carpeta `DC-CUP-3RA-EDICION` y ejecuta:

```powershell
npm install
npm run dev
```

Luego entra a:

```text
http://localhost:5173
```

La API se ejecuta en:

```text
http://localhost:4000
```

## Administrador local incluido

El archivo `.env` de esta entrega ya está preparado para uso local. Antes de publicar el proyecto en Internet, cambia la contraseña del administrador y el `JWT_SECRET`.

## Crear un JWT_SECRET nuevo

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Pega el resultado en `.env`.

---

## Publicar para que todos vean los mismos cambios

No publiques solamente el frontend estático. Esta página necesita un **servidor Node.js central**, porque las cuentas, puntajes, configuración y logos viven en el backend.

Flujo de despliegue recomendado:

```powershell
npm install
npm run build
npm start
```

Variables necesarias:

```env
PORT=4000
ADMIN_USER=tu_admin
ADMIN_PASSWORD=una_contraseña_segura_de_12_o_mas
JWT_SECRET=un_secreto_aleatorio_de_32_o_mas
NODE_ENV=production
TRUST_PROXY=1
```

Para no perder datos al reiniciar el hosting, usa almacenamiento persistente y apunta:

```env
DATA_DIR=/ruta/persistente/data
UPLOAD_DIR=/ruta/persistente/uploads
```

`DATA_DIR` guarda `dc-cup.sqlite` y `UPLOAD_DIR` guarda logos, jugadores, moderadores, portada y música.

Si el hosting elimina archivos locales en cada despliegue y no tiene disco persistente, los datos podrían reiniciarse. En ese caso necesitas un volumen persistente o migrar la base de datos a un servicio administrado.

Lee también `DEPLOY_PUBLICO.md`.

---

## Importante al cambiar el formato

Al guardar una nueva estructura competitiva:

- se regeneran las salas;
- se eliminan los resultados anteriores;
- **NO** se eliminan equipos;
- **NO** se eliminan logos;
- **NO** se eliminan rosters;
- **NO** se eliminan cuentas.

Esto evita mezclar puntajes de dos formatos distintos.

## Seguridad

- `.env` está ignorado por Git.
- Las contraseñas se guardan con bcrypt.
- El admin principal puede restablecer contraseñas, pero no leer la contraseña anterior.
- Los admins de puntajes tienen permisos limitados.
- En producción usa HTTPS.
- Cambia las credenciales incluidas antes de publicar.

## Archivos principales

- `client/src/main.jsx` — interfaz pública y paneles.
- `client/src/styles.css` — diseño responsive esports.
- `server/index.js` — API, permisos, SSE y lógica del torneo.
- `server/database.js` — SQLite, migraciones y estructura dinámica.
- `server/scoring.js` — sistema de puntaje.
- `server/reset-admin.js` — recuperación del administrador principal.
