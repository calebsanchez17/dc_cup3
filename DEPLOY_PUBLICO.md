# PUBLICAR DC CUP Y COMPARTIR LAS ACTUALIZACIONES

Para que un cambio hecho por el administrador sea visible para todos, **todos deben entrar a la misma instancia del backend**.

## 1. Compilar

```powershell
npm install
npm run build
```

## 2. Iniciar producción

```powershell
npm start
```

El servidor Express sirve la carpeta compilada `client/dist` y la API desde el mismo dominio.

## 3. Variables del servidor

```env
PORT=4000
ADMIN_USER=tu_usuario
ADMIN_PASSWORD=tu_contraseña_segura
JWT_SECRET=tu_secreto_largo
NODE_ENV=production
TRUST_PROXY=1
DATA_DIR=/ruta/persistente/data
UPLOAD_DIR=/ruta/persistente/uploads
```

## 4. Persistencia

Debes conservar dos rutas entre reinicios/despliegues:

- `DATA_DIR`: contiene la base `dc-cup.sqlite`.
- `UPLOAD_DIR`: contiene logos, fotos, música y portada LIVE.

Si usas un proveedor con volumen/disco persistente, monta ese volumen y usa sus rutas en las variables anteriores.

## 5. Actualización en vivo

El sistema usa `/api/events` con Server-Sent Events. Al guardar formato, producción, equipos, staff o resultados, los navegadores conectados reciben una señal y actualizan la información pública automáticamente.

También existe un refresco de respaldo cada 30 segundos.

## 6. GitHub

Puedes subir el código a GitHub, pero **no subas `.env` ni la base de datos de producción**. `.gitignore` ya los excluye.

GitHub Pages por sí solo no es suficiente para este proyecto, porque aquí necesitas Node.js, autenticación, base de datos y subida de archivos.
