# OpenAI Local Proxy — Manual para Clientes REST (Postman / Insomnia)

Este documento explica cómo hacer peticiones al proxy local utilizando clientes de API visuales como **Postman**, **Insomnia**, o **Thunder Client**, en lugar de utilizar comandos de consola como `curl`.

**Base URL:** `http://localhost:3000`

---

## Tabla de contenidos

1. [Configuración Inicial](#configuración-inicial)
2. [GET /health (Verificar el sistema)](#get-health-verificar-el-sistema)
3. [POST /v1/chat/completions (Hacer consultas)](#post-v1chatcompletions-hacer-consultas)
4. [Casos de uso prácticos en Postman](#casos-de-uso-prácticos-en-postman)
5. [Errores comunes](#errores-comunes)

---

## Configuración Inicial

Si configuraste un `API_SECRET` en tu archivo `.env`, deberás enviarlo en todas tus peticiones dentro del cliente REST.

En **Postman**:
1. Ve a la pestaña **Authorization** de tu petición.
2. Selecciona el tipo **Bearer Token**.
3. En el campo "Token", pega el valor de tu `API_SECRET`.

En general, esto añade automáticamente el siguiente Header a todas tus consultas:
`Authorization: Bearer <tu_token_secreto>`

Si no tienes `API_SECRET` configurado, puedes omitir el paso de Authorization.

---

## GET /health (Verificar el sistema)

Verifica que tanto tu proxy como OpenCode están activos antes de empezar a chatear.

*   **Método:** `GET`
*   **URL:** `http://localhost:3000/health`
*   **Headers:** `Authorization` (si aplica)
*   **Body:** (Ninguno / None)

Al presionar **Send**, deberías recibir esta respuesta (Status `200 OK`):

```json
{
  "status": "ok",
  "proxy": "running",
  "opencode": "connected",
  "default_model": "openai/gpt-5.4"
}
```

---

## POST /v1/chat/completions (Hacer consultas)

Este es el endpoint principal donde te comunicas con el modelo.

*   **Método:** `POST`
*   **URL:** `http://localhost:3000/v1/chat/completions`

### 1. Configurar los Headers
En la pestaña **Headers** de tu cliente:
*   `Content-Type`: `application/json`
*(Postman normalmente lo agrega de forma automática al configurar el Body como JSON).*

### 2. Configurar el Body
En la pestaña **Body**, selecciona **raw** y asegúrate de elegir **JSON** en el menú desplegable (en lugar de Text).

Dibuja tu petición siguiendo esta estructura básica:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hola, ¿puedes darme un saludo en 3 idiomas diferentes?"
    }
  ]
}
```

Al presionar **Send**, la respuesta te llegará estructurada en la parte inferior:

```json
{
  "id": "chatcmpl-44e1943b-f8f9-46c9-bf36-02b6106bde6a",
  "object": "chat.completion",
  "created": 1772829800,
  "model": "gpt-5.4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "¡Hola! Hello! Bonjour!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 10,
    "total_tokens": 25
  }
}
```
*Tip: El texto de respuesta siempre estará dentro de `choices[0].message.content`.*

---

## Casos de uso prácticos en Postman

Para probar diferentes comportamientos, solo necesitas cambiar el JSON en la pestaña **Body (raw > JSON)**.

### Caso 1: Extracción de datos (Devolver JSON estructurado)

Usa un mensaje con el rol `"system"` para indicarle al modelo cómo comportarse.

**Body**:
```json
{
  "messages": [
    {
      "role": "system",
      "content": "Eres un extractor de datos. Responde ÚNICAMENTE con JSON válido, sin texto adicional."
    },
    {
      "role": "user",
      "content": "Extrae los datos de este correo:\nDe: carlos@empresa.com\nAsunto: Reunión Q3\nFecha: 5 de marzo de 2026\nTexto: Nos vemos el lunes a las 10am."
    }
  ]
}
```

### Caso 2: Clasificar el tono de un texto

**Body**:
```json
{
  "messages": [
    {
      "role": "system",
      "content": "Clasificas mensajes. Responde SOLO con JSON: {\"urgencia\": \"alta|media|baja\", \"tono\": \"formal|informal\"}"
    },
    {
      "role": "user",
      "content": "Revisar el PDF urgente, el cliente está molesto."
    }
  ]
}
```

### Caso 3: Conversación con historial (Múltiples turnos)

Puesto que el proxy no guarda memoria (es stateless), para que el modelo recuerde de qué estaban hablando, debes enviar el historial completo:

**Body**:
```json
{
  "messages": [
    { "role": "user", "content": "¿Cuál es la capital de Francia?" },
    { "role": "assistant", "content": "La capital de Francia es París." },
    { "role": "user", "content": "¿Cuántos habitantes tiene esa ciudad?" }
  ]
}
```

### Caso 4: Seleccionar un modelo específico

Si quieres forzar un modelo distinto al default (ej. para programar):

**Body**:
```json
{
  "model": "openai/gpt-5.1-codex",
  "messages": [
    { "role": "user", "content": "Haz una función en Python para sumar arreglos." }
  ]
}
```

---

## Errores comunes en Clientes REST

### 1. HTTP 400 - "El campo 'messages' es requerido"
**Causa:** No seleccionaste `JSON` en el Body, o escribiste el JSON de forma inválida (falta una coma, tienes comillas simples en lugar de dobles).
**Solución en Postman:** Asegúrate de que **raw** y **JSON** estén seleccionados en la pestaña Body. Revisa el código de color de Postman; si hay algo en rojo, es un error de sintaxis JSON.

### 2. HTTP 400 - "Streaming no soportado"
**Causa:** Enviaste `"stream": true` en el Body.
**Solución:** Borra la línea `"stream": true` o cámbiala por `"stream": false`.

### 3. HTTP 401 - "Unauthorized"
**Causa:** Tienes configurada la variable `API_SECRET` en el archivo `.env`, pero olvidaste agregar el token en el cliente.
**Solución en Postman:** Ve a la pestaña **Authorization**, selecciona **Bearer Token** y pon tu clave.

### 4. HTTP 503 - "OpenCode server no está disponible" (ó timeout largo)
**Causa:** El servidor de OpenCode se cerró por detrás, o intentas enviar algo pero no tienes red.
**Solución:** Verifica tu terminal donde corre `npm start` para revisar errores de conexión de OpenCode y prueba llamar un `/health`.

### 5. HTTP 500 / 503 - "Credenciales expiradas"
**Causa:** Tu sesión de OpenAI caducó. Debería llegarte un correo con la notificación si ya lo configuraste.
**Solución:** Debes re-autenticar. Ve a la consola y ejecuta `opencode`, después escribe `/connect` para enlazar de nuevo tu ChatGPT.
