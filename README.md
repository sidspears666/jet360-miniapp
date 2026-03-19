# Mini App (FuelCards)

## Files
- `index.html`
- `styles.css`
- `app.js`

## Before deploy
1. Open `app.js`.
2. Update `API_BASE` if needed:
```js
const API_BASE = "https://flow.gojet.com.tr/webhook/fuelcards/miniapp";
```

## Endpoints expected by app
- `POST ${API_BASE}/session`
- `POST ${API_BASE}/action`

## BotFather
Set Menu Button URL to:
- `https://<your-miniapp-domain>/index.html`

## Important
The app must be opened inside Telegram Mini App (it uses `Telegram.WebApp.initData`).
