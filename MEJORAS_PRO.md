# DC CUP · CONTROL MAESTRO V3

Esta versión convierte el panel anterior en un centro de control completo para el torneo.

## Constructor del torneo

- De 1 a 8 fases configurables.
- Nombres automáticos sugeridos: Fase de Grupos, Cuartos de Final, Semifinal y Gran Final.
- Cantidad total de equipos configurable.
- Grupos por fase.
- Clasificación por grupo o por tabla general.
- Clasificados por grupo o clasificados totales.
- Jornadas configurables.
- Modalidad por grupos, cruces, todos juntos o cruces personalizados.
- Salas por cruce/grupo/jornada.
- Resultados y selector de salas reconstruidos automáticamente al guardar el formato.
- Booyah de Oro disponible únicamente en la fase final.

### Reglas competitivas incluidas

- Fases previas por grupos: 12 equipos por grupo.
- Semifinal: 18 equipos, 3 grupos de 6.
- Gran Final: 12 equipos, 1 grupo, modalidad Todos juntos.

## Producción y transmisión

- Cantidad libre de moderadores y casters.
- Nombre, Instagram y foto opcional por integrante.
- Título y etiqueta de la transmisión.
- URL HTTPS de transmisión.
- Estado EN VIVO AHORA.
- Portada horizontal para el directo.
- Música MP3/OGG para la web.

## Moderadores con acceso a puntajes

El jefe/administrador principal puede crear cuentas independientes para moderadores. Cada cuenta puede tener:

- nombre;
- Instagram;
- usuario y contraseña;
- foto;
- acceso activo/inactivo;
- visibilidad pública opcional.

Estas cuentas solo pueden registrar resultados oficiales y cambiar su propia contraseña. No pueden modificar el formato, equipos ni configuración maestra.

## Equipos y logos

El administrador principal dispone de una galería con todos los equipos activos, separados por grupo, con logo, nombre, slot y estado de cuenta. Los logos se pueden abrir y descargar individualmente.

## Actualización pública

Los cambios guardados en formato, producción, equipos o resultados se notifican a los navegadores conectados mediante Server-Sent Events. Existe además un refresco de respaldo cada 30 segundos.

Para que esto funcione en Internet todos los visitantes deben usar la misma aplicación Node/Express desplegada con almacenamiento persistente para la base de datos y los archivos subidos.
