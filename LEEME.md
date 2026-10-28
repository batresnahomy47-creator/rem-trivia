# REM · Trivia express para el stand

Los visitantes escanean un QR, juegan desde su celular (5 preguntas, 12 segundos cada una) y su puntaje aparece al instante en la pantalla grande. Al final del día muestras el podio de ganadores y descargas los contactos en CSV.

## Las tres direcciones

| Qué | Dirección | Dónde se abre |
|---|---|---|
| Pantalla del stand | `/pantalla` | En la laptop conectada a la TV |
| Juego | `/` | En los celulares, con el QR |
| Administración | `/admin` | Solo tú (clave por defecto: `rem2026`) |

En la pantalla: tecla **F** pantalla completa, **G** muestra los ganadores (se revelan 3.º, 2.º y 1.º), **Esc** vuelve al ranking.

## Opción A · Publicarlo en internet (los visitantes usan sus datos móviles o el wifi del evento)

La forma más simple es Render.com (tiene plan gratuito):

1. Crea una cuenta en GitHub y sube esta carpeta como un repositorio nuevo.
2. En Render.com, elige **New → Web Service** y conecta ese repositorio.
3. Configura: Build command vacío, Start command `node server.js`.
4. En **Environment** agrega `CLAVE_ADMIN` con una clave tuya.
5. Render te da una dirección tipo `https://rem-trivia.onrender.com`. Abre `/pantalla` en la laptop del stand y el QR ya apunta al lugar correcto.

Dos cuidados con el plan gratuito: el servicio "se duerme" si nadie lo usa por 15 minutos (abre la pantalla un rato antes del evento para despertarlo) y los datos se borran si el servicio se reinicia, así que **descarga el CSV desde /admin al final de cada jornada**. Con el plan pagado más básico ambos problemas desaparecen.

## Opción B · Correrlo en la laptop del stand

Útil para probar en la oficina o si el evento tiene mala señal.

1. Instala Node.js (versión 18 o superior) desde nodejs.org.
2. Doble clic en `INICIAR-Windows.bat` o `INICIAR-Mac.command`.
3. La pantalla se abre sola. Los celulares deben estar en **la misma red wifi** que la laptop (un router propio sin internet sirve). El QR usa la IP local automáticamente.

## Personalizar

- **Preguntas:** edita `preguntas.js`. La primera opción de cada pregunta es la correcta; el juego las mezcla solo.
- **Cantidad y tiempo:** en `server.js`, cambia `PREGUNTAS_POR_PARTIDA` y `SEGUNDOS_POR_PREGUNTA`.
- **Textos:** están en `public/jugar.html` y `public/pantalla.html`.

## Cómo se calcula el puntaje

Cada acierto vale 100 puntos más hasta 50 extra según la rapidez. El tiempo lo mide el servidor, así que no se puede hacer trampa desde el celular. Si alguien juega varias veces con el mismo contacto, se guarda solo su mejor puntaje. En empate gana quien respondió más rápido.
