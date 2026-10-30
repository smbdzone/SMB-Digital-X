// Service worker for chat push notifications. Served at /sw.js

// Take control right away after an update (otherwise phones keep running the old worker for a long time)
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }

  // IMPORTANT: every push must show a notification (iOS removes the subscription of sites that receive silent pushes).
  const options = {
    body: data.body || '',
    icon: '/icon-192-1.png',
    badge: '/badge-72-1.png',
    data: { url: data.url || '/chat' },
  }

  // same chat = replaces the previous notification, but still alerts (sound/vibration) on phones.
  // renotify without a tag throws an error, so both are set together.
  if (data.tag) {
    options.tag = data.tag
    options.renotify = true
  }

  event.waitUntil(self.registration.showNotification(data.title || 'New message', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/chat'

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          try {
            await client.focus()
            if ('navigate' in client) await client.navigate(url)
            return
          } catch (e) {
            // some mobile browsers refuse focus()/navigate(): fall back to opening a window
          }
        }
      }
      await clients.openWindow(url)
    })()
  )
})
