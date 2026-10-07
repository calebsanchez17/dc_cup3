# Actualizar una instalación anterior sin perder logos ni rosters

Si ya tienes una versión anterior de DC CUP:

1. Detén el servidor con `Ctrl + C`.
2. Haz una copia de seguridad completa de tu proyecto anterior.
3. Conserva especialmente:
   - `.env`
   - `server/data/dc-cup.sqlite`
   - la carpeta `uploads/`
4. Extrae esta V3 en una carpeta nueva.
5. Si deseas conservar cuentas, equipos, logos y rosters, copia `server/data/dc-cup.sqlite` y `uploads/` del proyecto anterior a esta carpeta nueva.
6. Revisa el `.env`. Esta entrega trae credenciales locales configuradas, pero para una instalación ya existente puedes mantener tus propias credenciales si cumplen las validaciones.
7. Ejecuta:

```powershell
npm install
npm run dev
```

La V3 crea automáticamente las nuevas tablas y columnas necesarias para fases dinámicas, moderadores de puntajes y producción.

## Importante sobre resultados antiguos

La V3 usa un motor nuevo de salas/resultados por fases. Haz siempre una copia de seguridad antes de migrar. Al guardar una estructura nueva desde `FORMATO Y FASES`, el sistema reconstruye las salas y elimina los resultados del formato anterior para evitar mezclar competencias incompatibles. Los equipos, cuentas, logos y rosters se conservan.
