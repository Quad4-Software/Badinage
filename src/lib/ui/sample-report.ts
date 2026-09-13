// A representative crash report after scrubbing, shown to users before
// they opt in so they can see exactly what leaves the device. Fields
// the scrubber strips (user context, request bodies, cookies, stanza
// payloads, addresses) are absent on purpose.

export const SAMPLE_REPORT = `{
  "event_id": "a1b2c3d4e5f6478899aabbccddee0011",
  "timestamp": "2025-06-01T12:04:31.102Z",
  "platform": "javascript",
  "level": "error",
  "exception": {
    "values": [
      {
        "type": "TypeError",
        "value": "Cannot read properties of undefined (reading 'peerJid')",
        "stacktrace": {
          "frames": [
            {
              "function": "sendMessage",
              "filename": "https://badinage.example/assets/index-B4x2.js",
              "lineno": 412,
              "colno": 18
            }
          ]
        }
      }
    ]
  },
  "breadcrumbs": [
    {
      "category": "console",
      "level": "info",
      "message": "presence update from [redacted-address]"
    },
    {
      "category": "navigation",
      "data": { "to": "https://badinage.example/" }
    }
  ],
  "contexts": {
    "browser": { "name": "Firefox", "version": "141.0" },
    "os": { "name": "Linux" }
  }
}`
