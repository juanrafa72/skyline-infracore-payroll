# Acceso desde otros computadores de la oficina

Para que Leo (o quien sea) entre al sistema desde su propio computador, sin
publicar nada en internet. El servidor corre en el Mac de Rafael; los demás
entran por la red de la oficina.

## La dirección que usa Leo

```
http://macbook-air-de-juan-2.local:3100
```

Ese nombre (`.local`) es el del Mac de Rafael y **no cambia** aunque el router
reparta otra dirección. Si algún computador no entiende los nombres `.local`
(pasa en algunos Windows viejos), se usa la dirección numérica del momento —
hoy `http://192.168.1.14:3100` — que se consulta en el Mac con:

```bash
ipconfig getifaddr en0
```

## Qué tiene que estar cumplido (verificado el 2026-08-14)

1. **El servidor encendido en el Mac de Rafael** — desde la carpeta del proyecto:
   `npm run build && npm run start` (queda en el puerto 3100 y escucha a toda la
   red; verificado con `lsof -nP -iTCP:3100 -sTCP:LISTEN` → `*:3100`).
2. **`SESSION_COOKIE_SECURE=false` en el `.env`** — ya está puesto. Sin esto, el
   navegador de Leo bota la credencial de sesión por venir en conexión simple y
   el login se vuelve un bucle. (Solo aplica a la red de la oficina; un sitio
   publicado con HTTPS no lleva esta variable.)
3. **Firewall del Mac** — hoy está apagado, así que no estorba. Si algún día se
   enciende, hay que permitirle conexiones entrantes a `node` (la primera vez
   macOS pregunta con un aviso; decir "Permitir").
4. **Misma red** — el computador de Leo y el Mac en el mismo WiFi/cable de la
   oficina. Las redes "de invitados" suelen aislar los equipos entre sí y ahí no
   se ven.
5. **El Mac despierto** — si se duerme, el sistema se cae para todos. En
   Ajustes → Pantalla y Energía, evitar que se duerma estando enchufado.

## Crear el usuario de Leo (una sola vez)

```bash
npm run user:create "Leo <apellido>" <correo-de-leo> PAYROLL_PREPARER SKYLINE,INFRACORE
```

Imprime una contraseña temporal **una sola vez**. Al primer ingreso el sistema
lo obliga a cambiarla antes de dejarlo entrar a cualquier pantalla.

## Si a Leo "no le abre", en este orden

1. Desde el computador de Leo, en una terminal o en el navegador:
   `http://macbook-air-de-juan-2.local:3100/login`
   - **No carga nada** → problema de red o servidor apagado (puntos 1, 4, 5).
   - **Carga el login pero al entrar lo devuelve al login** → falta el punto 2
     (reiniciar el servidor después de tocar el `.env`).
2. En el Mac: `lsof -nP -iTCP:3100 -sTCP:LISTEN` — debe decir `*:3100`.
3. Tras cambiar `.env` o actualizar el sistema: matar el proceso del puerto 3100
   y volver a `npm run start` (un servidor viejo miente — ver CLAUDE.md).
